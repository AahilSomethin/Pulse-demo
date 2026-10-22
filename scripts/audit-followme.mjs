/**
 * Streams each FollowMe day once and writes aggregate counts.
 * The output has no IMEIs, coordinates, or raw rows.
 */
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const directory = path.resolve("data/FollowMe/FollowMe_august_2025");
const target = path.resolve("src/data/followme-quality.json");
const BOX = { minLat: -0.8, maxLat: 7.2, minLon: 72.5, maxLon: 73.9 };
const IMPLAUSIBLE_KN = 40;
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320;
const M_PER_NM = 1852;

function distanceM(lon1, lat1, lon2, lat2) {
  const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dx = (lon2 - lon1) * Math.cos(midLat) * M_PER_DEG_LNG;
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

function impliedKnots(meters, durationMs) {
  if (!(durationMs > 0)) return Number.POSITIVE_INFINITY;
  return meters / M_PER_NM / (durationMs / 3_600_000);
}

function parseUtc(raw) {
  const trimmed = raw.trim();
  if (!trimmed || /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return Number.NaN;
  return Date.parse(`${trimmed.replace(" ", "T")}Z`);
}

function splitCsvLine(line) {
  if (!line.includes('"')) return line.split(",");
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else quoted = false;
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function bucket(value, edges) {
  for (let index = 0; index < edges.length - 1; index += 1) {
    if (value >= edges[index] && value < edges[index + 1]) return index;
  }
  return edges.length - 2;
}

const speedEdges = [0, 0.5, 5, 15, 40, Number.POSITIVE_INFINITY];
const speedLabels = ["under 0.5", "0.5–5", "5–15", "15–40", "over 40"];
const intervalEdges = [0, 30, 60, 300, 1200, 3600, Number.POSITIVE_INFINITY];
const intervalLabels = ["under 30 s", "30–60 s", "1–5 min", "5–20 min", "20–60 min", "over 60 min"];

function takeSample(samples, seen, value, cap = 80_000) {
  seen.n += 1;
  if (samples.length < cap) samples.push(value);
  else if (seen.n % 17 === 0) samples[seen.n % cap] = value;
}

async function scanFile(filePath) {
  const started = performance.now();
  const bytes = (await stat(filePath)).size;
  const stream = createReadStream(filePath);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let timeIndex = -1;
  let savedIndex = -1;
  let latIndex = -1;
  let lonIndex = -1;
  let speedIndex = -1;
  let imeiIndex = -1;
  let headingIndex = -1;
  let networkIndex = -1;
  const ids = new Map();
  const names = [];
  let capacity = 65_536;
  let count = 0;
  let timeMs = new Float64Array(capacity);
  let savedMs = new Float64Array(capacity);
  let lat = new Float32Array(capacity);
  let lon = new Float32Array(capacity);
  let speed = new Float32Array(capacity);
  let device = new Int32Array(capacity);
  const stats = {
    rowsKept: 0,
    duplicate: 0,
    outOfBox: 0,
    badTime: 0,
    blank: 0,
    zeroDurationMoves: 0,
    implausibleJumps: 0,
    identicalConsecutive: 0,
    minuteMarks: 0,
    headingMin: null,
    headingMax: null,
    network: { dhiraagu: 0, ooredoo: 0, other: 0, missing: 0 },
    maxSpeed: 0,
    t0: null,
    t1: null,
  };
  const speedCounts = speedLabels.map(() => 0);
  const intervalCounts = intervalLabels.map(() => 0);
  const moving = [];
  const intervals = [];
  const lags = [];
  const movingSeen = { n: 0 };
  const intervalSeen = { n: 0 };
  const lagSeen = { n: 0 };

  function grow() {
    const next = capacity * 2;
    const copy = (source, Type) => {
      const target = new Type(next);
      target.set(source);
      return target;
    };
    timeMs = copy(timeMs, Float64Array);
    savedMs = copy(savedMs, Float64Array);
    lat = copy(lat, Float32Array);
    lon = copy(lon, Float32Array);
    speed = copy(speed, Float32Array);
    device = copy(device, Int32Array);
    capacity = next;
  }

  for await (const line of lines) {
    if (!header) {
      const cells = splitCsvLine(line.replace(/^\uFEFF/, "")).map((cell) => cell.trim());
      header = cells;
      timeIndex = cells.indexOf("device_date");
      if (timeIndex < 0) {
        imeiIndex = 1;
        timeIndex = 3;
        latIndex = 4;
        lonIndex = 5;
        speedIndex = 6;
      } else {
        savedIndex = cells.indexOf("timestamp");
        latIndex = cells.indexOf("latitude");
        lonIndex = cells.indexOf("longitude");
        speedIndex = cells.indexOf("speed");
        imeiIndex = cells.indexOf("imei");
        headingIndex = cells.indexOf("heading");
        networkIndex = cells.indexOf("network");
      }
      continue;
    }
    if (!line) {
      stats.blank += 1;
      continue;
    }
    const cells = splitCsvLine(line);
    const rowLat = Number(cells[latIndex]);
    const rowLon = Number(cells[lonIndex]);
    if (!(rowLat > BOX.minLat && rowLat < BOX.maxLat && rowLon > BOX.minLon && rowLon < BOX.maxLon)) {
      stats.outOfBox += 1;
      continue;
    }
    const rowTime = parseUtc(cells[timeIndex] ?? "");
    if (!Number.isFinite(rowTime)) {
      stats.badTime += 1;
      continue;
    }
    const rowSaved = savedIndex >= 0 ? parseUtc(cells[savedIndex] ?? "") : rowTime;
    const imei = cells[imeiIndex] === undefined ? "undefined" : String(cells[imeiIndex]).trim();
    const speedRaw = Number(cells[speedIndex]);
    const speedValue = Number.isFinite(speedRaw) ? speedRaw : 0;
    if (count === capacity) grow();
    let deviceId = ids.get(imei);
    if (deviceId === undefined) {
      deviceId = names.length;
      ids.set(imei, deviceId);
      names.push(imei);
    }
    timeMs[count] = rowTime;
    savedMs[count] = Number.isFinite(rowSaved) ? rowSaved : rowTime;
    lat[count] = rowLat;
    lon[count] = rowLon;
    speed[count] = speedValue;
    device[count] = deviceId;
    count += 1;
    const rawDate = (cells[timeIndex] ?? "").replace(/"/g, "").trim();
    if (rawDate.endsWith(":00")) stats.minuteMarks += 1;
    if (headingIndex >= 0 && cells[headingIndex] !== undefined && cells[headingIndex] !== "") {
      const heading = Number(cells[headingIndex]);
      if (Number.isFinite(heading)) {
        stats.headingMin = stats.headingMin == null ? heading : Math.min(stats.headingMin, heading);
        stats.headingMax = stats.headingMax == null ? heading : Math.max(stats.headingMax, heading);
      }
    }
    if (networkIndex >= 0) {
      const network = Number(cells[networkIndex]);
      if (network === 1) stats.network.dhiraagu += 1;
      else if (network === 2) stats.network.ooredoo += 1;
      else if (cells[networkIndex] === "" || cells[networkIndex] === undefined) stats.network.missing += 1;
      else stats.network.other += 1;
    }
  }

  const order = Array.from({ length: count }, (_, index) => index);
  order.sort((a, b) => timeMs[a] - timeMs[b] || savedMs[a] - savedMs[b] || a - b);
  const last = names.map(() => null);
  for (const index of order) {
    const id = device[index];
    const previous = last[id];
    if (previous && previous.timeMs === timeMs[index] && previous.lat === lat[index] && previous.lon === lon[index]) {
      stats.duplicate += 1;
      continue;
    }
    if (previous) {
      const duration = timeMs[index] - previous.timeMs;
      const meters = distanceM(previous.lon, previous.lat, lon[index], lat[index]);
      if (duration === 0 && meters >= 1) stats.zeroDurationMoves += 1;
      else if (duration > 0) {
        const seconds = duration / 1000;
        takeSample(intervals, intervalSeen, seconds);
        intervalCounts[bucket(seconds, intervalEdges)] += 1;
        if (meters < 1) stats.identicalConsecutive += 1;
        else if (impliedKnots(meters, duration) > IMPLAUSIBLE_KN) stats.implausibleJumps += 1;
      }
    }
    last[id] = { timeMs: timeMs[index], lat: lat[index], lon: lon[index] };
    stats.rowsKept += 1;
    stats.t0 = stats.t0 == null ? timeMs[index] : Math.min(stats.t0, timeMs[index]);
    stats.t1 = stats.t1 == null ? timeMs[index] : Math.max(stats.t1, timeMs[index]);
    if (speed[index] > stats.maxSpeed) stats.maxSpeed = speed[index];
    if (speed[index] >= 0.5) takeSample(moving, movingSeen, speed[index]);
    speedCounts[bucket(Math.max(speed[index], 0), speedEdges)] += 1;
    takeSample(lags, lagSeen, (savedMs[index] - timeMs[index]) / 1000);
  }

  return {
    file: path.basename(filePath),
    bytes,
    milliseconds: Math.round(performance.now() - started),
    devices: names.length,
    deviceIds: names,
    stats,
    moving,
    intervals,
    lags,
    speedCounts,
    intervalCounts,
  };
}

const names = (await readdir(directory)).filter((name) => name.toLowerCase().endsWith(".csv")).sort((a, b) => {
  const na = Number(a.replace(/\.csv$/i, ""));
  const nb = Number(b.replace(/\.csv$/i, ""));
  return na - nb;
});

const allDevices = new Set();
const days = [];
let bytes = 0;
let rowsKept = 0;
let duplicate = 0;
let outOfBox = 0;
let badTime = 0;
let blank = 0;
let zeroDurationMoves = 0;
let implausibleJumps = 0;
let identicalConsecutive = 0;
let minuteMarks = 0;
let maxSpeed = 0;
let headingMin = null;
let headingMax = null;
let parseMs = 0;
let t0 = null;
let t1 = null;
const network = { dhiraagu: 0, ooredoo: 0, other: 0, missing: 0 };
const moving = [];
const intervals = [];
const lags = [];
const movingSeen = { n: 0 };
const intervalSeen = { n: 0 };
const lagSeen = { n: 0 };
const speedCounts = speedLabels.map(() => 0);
const intervalCounts = intervalLabels.map(() => 0);

for (const name of names) {
  const result = await scanFile(path.join(directory, name));
  for (const id of result.deviceIds) allDevices.add(id);
  bytes += result.bytes;
  parseMs += result.milliseconds;
  rowsKept += result.stats.rowsKept;
  duplicate += result.stats.duplicate;
  outOfBox += result.stats.outOfBox;
  badTime += result.stats.badTime;
  blank += result.stats.blank;
  zeroDurationMoves += result.stats.zeroDurationMoves;
  implausibleJumps += result.stats.implausibleJumps;
  identicalConsecutive += result.stats.identicalConsecutive;
  minuteMarks += result.stats.minuteMarks;
  maxSpeed = Math.max(maxSpeed, result.stats.maxSpeed);
  if (result.stats.headingMin != null) headingMin = headingMin == null ? result.stats.headingMin : Math.min(headingMin, result.stats.headingMin);
  if (result.stats.headingMax != null) headingMax = headingMax == null ? result.stats.headingMax : Math.max(headingMax, result.stats.headingMax);
  t0 = t0 == null || result.stats.t0 < t0 ? result.stats.t0 : t0;
  t1 = t1 == null || result.stats.t1 > t1 ? result.stats.t1 : t1;
  for (const key of Object.keys(network)) network[key] += result.stats.network[key];
  for (const value of result.moving) takeSample(moving, movingSeen, value);
  for (const value of result.intervals) takeSample(intervals, intervalSeen, value);
  for (const value of result.lags) takeSample(lags, lagSeen, value);
  result.speedCounts.forEach((count, index) => {
    speedCounts[index] += count;
  });
  result.intervalCounts.forEach((count, index) => {
    intervalCounts[index] += count;
  });
  days.push({
    day: name.replace(/\.csv$/i, ""),
    bytes: result.bytes,
    rowsKept: result.stats.rowsKept,
    devices: result.devices,
    duplicates: result.stats.duplicate,
    implausibleJumps: result.stats.implausibleJumps,
    milliseconds: result.milliseconds,
  });
  console.log(`${name} rows=${result.stats.rowsKept} devices=${result.devices} ${result.milliseconds}ms`);
}

const report = {
  status: "ready",
  generatedAt: new Date().toISOString(),
  fileCount: names.length,
  bytes,
  rowsKept,
  rowsDuplicate: duplicate,
  rowsOutOfBox: outOfBox,
  rowsBadTime: badTime,
  rowsBlank: blank,
  devices: allDevices.size,
  zeroDurationMoves,
  implausibleJumps,
  identicalConsecutive,
  medianIntervalSec: median(intervals),
  medianLagSec: median(lags),
  minuteQuantizedShare: rowsKept === 0 ? null : minuteMarks / rowsKept,
  medianMovingKn: median(moving),
  maxSpeed,
  headingVaries: headingMin != null && headingMax != null && headingMin !== headingMax,
  network,
  parseMs,
  rowsPerSecond: parseMs > 0 ? Math.round((rowsKept / parseMs) * 1000) : null,
  t0: t0 == null ? null : new Date(t0).toISOString(),
  t1: t1 == null ? null : new Date(t1).toISOString(),
  speedBuckets: speedLabels.map((label, index) => ({ label, count: speedCounts[index] })),
  intervalBuckets: intervalLabels.map((label, index) => ({ label, count: intervalCounts[index] })),
  days,
  notes: [
    "Counts describe the August 2025 FollowMe extract only.",
    "device_date is the observation clock. timestamp breaks ties and is not treated as a second position.",
    "Reported speed has no documented unit. Figures are unconverted.",
    "A jump is a consecutive pair on one device whose straight-line speed exceeds 40 knots. It is a data-quality flag, not a passage.",
    "Median interval, lag, and moving speed are deterministic samples of up to 80,000 values, not a sort of every ping.",
    "No IMEI or coordinate is stored in this file.",
  ],
};

await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${target}`);
console.log(`devices=${report.devices} rows=${report.rowsKept} rows/s=${report.rowsPerSecond}`);
