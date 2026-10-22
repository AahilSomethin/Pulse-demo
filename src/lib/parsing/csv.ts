import { MALDIVES_BOX } from "@/config/constants";

export interface ParsedRow {
  timeMs: number;
  savedMs: number;
  lat: number;
  lon: number;
  speed: number;
  imei: string;
  heading: number;
  network: number;
  gsm: number;
}

export interface ParseRejection {
  blank: number;
  outOfBox: number;
  badTime: number;
  duplicate: number;
}

export interface CsvParseResult {
  rows: ParsedRow[];
  rejected: ParseRejection;
  headerMode: "named" | "positional";
  minuteMarks: number;
  hasTimestamp: boolean;
  hasHeading: boolean;
  hasNetwork: boolean;
  hasGsm: boolean;
}

export interface ParsedColumns {
  timeMs: Float64Array;
  savedMs: Float64Array;
  lat: Float32Array;
  lon: Float32Array;
  speed: Float32Array;
  heading: Int16Array;
  network: Int8Array;
  gsm: Int16Array;
  deviceIndex: Int32Array;
  names: string[];
  count: number;
  rejected: ParseRejection;
  headerMode: CsvParseResult["headerMode"];
  minuteMarks: number;
  hasTimestamp: boolean;
  hasHeading: boolean;
  hasNetwork: boolean;
  hasGsm: boolean;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  return value;
}

export function splitCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const parts = line.split(",");
  const cells: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    let value = parts[index];
    if (value.startsWith('"') && !value.endsWith('"')) {
      while (index + 1 < parts.length) {
        index += 1;
        value += `,${parts[index]}`;
        if (parts[index].endsWith('"')) break;
      }
    }
    cells.push(unquote(value));
  }
  return cells;
}

/**
 * A naive timestamp is UTC, matching the original viewer and the August extract.
 * A value that already ends in Z or a numeric offset keeps that instant.
 */
export function parseUtcTimestamp(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return Number.NaN;
  const zoned = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const iso = trimmed.replace(" ", "T");
  return Date.parse(zoned ? iso : `${iso}Z`);
}

function insideBox(lat: number, lon: number): boolean {
  return lat > MALDIVES_BOX.minLat && lat < MALDIVES_BOX.maxLat && lon > MALDIVES_BOX.minLon && lon < MALDIVES_BOX.maxLon;
}

/**
 * Named FollowMe headers, or the original headerless column positions.
 * device_date is the observation clock. timestamp only breaks ties inside that minute.
 * Exact duplicate device/time/position rows are dropped and counted.
 */
export function prepareColumns(text: string): ParsedColumns {
  let source = text;
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const rejected: ParseRejection = { blank: 0, outOfBox: 0, badTime: 0, duplicate: 0 };
  let headerMode: ParsedColumns["headerMode"] = "named";
  let timeIndex = -1;
  let savedIndex = -1;
  let latIndex = -1;
  let lonIndex = -1;
  let speedIndex = -1;
  let imeiIndex = -1;
  let headingIndex = -1;
  let networkIndex = -1;
  let gsmIndex = -1;
  let headerReady = false;

  let capacity = Math.max(1024, Math.min(1_048_576, Math.ceil(source.length / 90)));
  let count = 0;
  let timeMs = new Float64Array(capacity);
  let savedMs = new Float64Array(capacity);
  let lat = new Float32Array(capacity);
  let lon = new Float32Array(capacity);
  let speed = new Float32Array(capacity);
  let heading = new Int16Array(capacity);
  let network = new Int8Array(capacity);
  let gsm = new Int16Array(capacity);
  let provisional = new Int32Array(capacity);
  const idOf = new Map<string, number>();
  const provisionalNames: string[] = [];

  const grow = () => {
    const next = capacity * 2;
    const copy = <T extends Float64Array | Float32Array | Int32Array | Int16Array | Int8Array>(values: T, Type: new (length: number) => T) => {
      const target = new Type(next);
      target.set(values);
      return target;
    };
    timeMs = copy(timeMs, Float64Array);
    savedMs = copy(savedMs, Float64Array);
    lat = copy(lat, Float32Array);
    lon = copy(lon, Float32Array);
    speed = copy(speed, Float32Array);
    heading = copy(heading, Int16Array);
    network = copy(network, Int8Array);
    gsm = copy(gsm, Int16Array);
    provisional = copy(provisional, Int32Array);
    capacity = next;
  };

  let cursor = 0;
  while (cursor <= source.length) {
    const breakAt = source.indexOf("\n", cursor);
    const end = breakAt < 0 ? source.length : breakAt;
    let line = source.slice(cursor, end);
    cursor = end + 1;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!headerReady) {
      headerReady = true;
      const header = splitCsvLine(line).map((cell) => cell.trim().replace(/"/g, ""));
      if (header.includes("device_date")) {
        timeIndex = header.indexOf("device_date");
        savedIndex = header.indexOf("timestamp");
        latIndex = header.indexOf("latitude");
        lonIndex = header.indexOf("longitude");
        speedIndex = header.indexOf("speed");
        imeiIndex = header.indexOf("imei");
        headingIndex = header.indexOf("heading");
        networkIndex = header.indexOf("network");
        gsmIndex = header.indexOf("gsm_level");
        if (breakAt < 0) break;
        continue;
      }
      imeiIndex = 1;
      timeIndex = 3;
      latIndex = 4;
      lonIndex = 5;
      speedIndex = 6;
      headerMode = "positional";
    }
    if (!line) {
      if (cursor <= source.length) rejected.blank += 1;
      if (breakAt < 0) break;
      continue;
    }
    const cells = splitCsvLine(line);
    const rowLat = Number(cells[latIndex]);
    const rowLon = Number(cells[lonIndex]);
    if (!insideBox(rowLat, rowLon)) {
      rejected.outOfBox += 1;
      if (breakAt < 0) break;
      continue;
    }
    const rawTime = (cells[timeIndex] ?? "").replace(/"/g, "");
    const rowTime = parseUtcTimestamp(rawTime);
    if (!Number.isFinite(rowTime)) {
      rejected.badTime += 1;
      if (breakAt < 0) break;
      continue;
    }
    const rawSaved = savedIndex >= 0 ? (cells[savedIndex] ?? "").replace(/"/g, "") : "";
    const rowSaved = savedIndex >= 0 ? parseUtcTimestamp(rawSaved) : rowTime;
    const imei = cells[imeiIndex] === undefined ? "undefined" : String(cells[imeiIndex]).trim();
    const speedRaw = Number(cells[speedIndex]);
    let device = idOf.get(imei);
    if (device === undefined) {
      device = provisionalNames.length;
      idOf.set(imei, device);
      provisionalNames.push(imei);
    }
    if (count === capacity) grow();
    timeMs[count] = rowTime;
    savedMs[count] = Number.isFinite(rowSaved) ? rowSaved : rowTime;
    lat[count] = rowLat;
    lon[count] = rowLon;
    speed[count] = Number.isFinite(speedRaw) ? speedRaw : 0;
    heading[count] = headingIndex >= 0 && cells[headingIndex] !== "" && Number.isFinite(Number(cells[headingIndex])) ? Number(cells[headingIndex]) : -1;
    const networkRaw = networkIndex >= 0 ? Number(cells[networkIndex]) : Number.NaN;
    network[count] = networkIndex < 0 || cells[networkIndex] === "" || !Number.isFinite(networkRaw) ? -1 : networkRaw;
    const gsmRaw = gsmIndex >= 0 ? Number(cells[gsmIndex]) : Number.NaN;
    gsm[count] = gsmIndex < 0 || cells[gsmIndex] === "" || !Number.isFinite(gsmRaw) ? -1 : gsmRaw;
    provisional[count] = device;
    count += 1;
    if (breakAt < 0) break;
  }

  const order = Array.from({ length: count }, (_, index) => index);
  order.sort((a, b) => timeMs[a] - timeMs[b] || savedMs[a] - savedMs[b] || a - b);

  const keptTime = new Float64Array(count);
  const keptSaved = new Float64Array(count);
  const keptLat = new Float32Array(count);
  const keptLon = new Float32Array(count);
  const keptSpeed = new Float32Array(count);
  const keptHeading = new Int16Array(count);
  const keptNetwork = new Int8Array(count);
  const keptGsm = new Int16Array(count);
  const deviceIndex = new Int32Array(count);
  const names: string[] = [];
  const nameOf = new Map<string, number>();
  const last = provisionalNames.map(() => null as { timeMs: number; lat: number; lon: number } | null);
  let kept = 0;
  let keptMinuteMarks = 0;

  for (const index of order) {
    const previous = last[provisional[index]];
    if (previous && previous.timeMs === timeMs[index] && previous.lat === lat[index] && previous.lon === lon[index]) {
      rejected.duplicate += 1;
      continue;
    }
    last[provisional[index]] = { timeMs: timeMs[index], lat: lat[index], lon: lon[index] };
    const imei = provisionalNames[provisional[index]];
    let device = nameOf.get(imei);
    if (device === undefined) {
      device = names.length;
      nameOf.set(imei, device);
      names.push(imei);
    }
    keptTime[kept] = timeMs[index];
    keptSaved[kept] = savedMs[index];
    keptLat[kept] = lat[index];
    keptLon[kept] = lon[index];
    keptSpeed[kept] = speed[index];
    keptHeading[kept] = heading[index];
    keptNetwork[kept] = network[index];
    keptGsm[kept] = gsm[index];
    deviceIndex[kept] = device;
    if (new Date(timeMs[index]).toISOString().slice(17, 19) === "00") keptMinuteMarks += 1;
    kept += 1;
  }

  const tight = <T extends Float64Array | Float32Array | Int32Array | Int16Array | Int8Array>(values: T): T => {
    const copy = new (values.constructor as new (length: number) => T)(kept);
    copy.set(values.subarray(0, kept));
    return copy;
  };

  return {
    timeMs: tight(keptTime),
    savedMs: tight(keptSaved),
    lat: tight(keptLat),
    lon: tight(keptLon),
    speed: tight(keptSpeed),
    heading: tight(keptHeading),
    network: tight(keptNetwork),
    gsm: tight(keptGsm),
    deviceIndex: tight(deviceIndex),
    names,
    count: kept,
    rejected,
    headerMode,
    minuteMarks: keptMinuteMarks,
    hasTimestamp: savedIndex >= 0,
    hasHeading: headingIndex >= 0,
    hasNetwork: networkIndex >= 0,
    hasGsm: gsmIndex >= 0,
  };
}

export function parseCsv(text: string): CsvParseResult {
  const columns = prepareColumns(text);
  const rows: ParsedRow[] = [];
  for (let index = 0; index < columns.count; index += 1) {
    rows.push({
      timeMs: columns.timeMs[index],
      savedMs: columns.savedMs[index],
      lat: columns.lat[index],
      lon: columns.lon[index],
      speed: columns.speed[index],
      imei: columns.names[columns.deviceIndex[index]] ?? "undefined",
      heading: columns.heading[index],
      network: columns.network[index],
      gsm: columns.gsm[index],
    });
  }
  return {
    rows,
    rejected: columns.rejected,
    headerMode: columns.headerMode,
    minuteMarks: columns.minuteMarks,
    hasTimestamp: columns.hasTimestamp,
    hasHeading: columns.hasHeading,
    hasNetwork: columns.hasNetwork,
    hasGsm: columns.hasGsm,
  };
}
