/**
 * Streams each FollowMe day, carries open dwells across midnight, and writes
 * pooled passage samples. The file has no IMEIs and no raw pings.
 * It is written under data/derived and is gitignored.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { CONNECTIVITY, DWELL_MAX_GAP_MS, DWELL_MIN_MS, DWELL_RADIUS_M, IMPLAUSIBLE_KN, SPARSE_GAP_MS, STOP_SPEED_KN } from "../src/config/constants";
import { emptyCarry, finish, ingest, type PassageCarry } from "../src/lib/analytics/passages";
import { dwellsSameIsland } from "../src/lib/analytics/same-island";
import type { StoredConnection, StoredMonth } from "../src/lib/analytics/month";
import { createPlaceLocator } from "../src/lib/geo/matching";
import { parseHarbourGeoJson } from "../src/lib/reference/harbours";
import { parseDataset } from "../src/lib/parsing/load-csv";
import { parseGeoJson } from "../src/lib/parsing/geojson";
import type { GeoConfidence, Journey } from "../src/types/maritime";

const directory = path.resolve("data/FollowMe/FollowMe_august_2025");
const target = path.resolve("data/derived/connectivity-august-2025.json");
const qualityPath = path.resolve("src/data/followme-quality.json");

interface Accumulator {
  originId: string;
  destinationId: string;
  originLabel: string;
  destinationLabel: string;
  originLat: number;
  originLon: number;
  destinationLat: number;
  destinationLon: number;
  originConfidence: GeoConfidence;
  destinationConfidence: GeoConfidence;
  originSourceId: string | null;
  destinationSourceId: string | null;
  originAtoll: string | null;
  destinationAtoll: string | null;
  vessels: Set<string>;
  dayCounts: number[];
  durationSec: number[];
  distanceM: number[];
  pathRatio: number[];
  excluded: number;
}

function rank(confidence: GeoConfidence): number {
  if (confidence === "named_polygon") return 2;
  if (confidence === "near_harbour") return 1;
  return 0;
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function main() {
const islandText = await readOptional(path.resolve("public/reference/osm-islands.geojson"));
const harbourText = await readOptional(path.resolve("public/reference/osm-harbours.geojson"));
const polygons = islandText ? parseGeoJson(islandText).polygons : [];
const harbours = harbourText ? parseHarbourGeoJson(harbourText) : [];
const locate = createPlaceLocator(polygons, harbours);

const names = (await readdir(directory)).filter((name) => /^\d+\.csv$/i.test(name)).sort((a, b) => Number(a.replace(/\.csv$/i, "")) - Number(b.replace(/\.csv$/i, "")));
const scanned = names.map((name) => Number(name.replace(/\.csv$/i, "")));
const carries = new Map<string, PassageCarry>();
const groups = new Map<string, Accumulator>();
const devices = new Set<string>();
let rowsKept = 0;
let sameIslandPassages = 0;
const dayReports: StoredMonth["days"] = [];

function augustIndex(ms: number): number {
  const date = new Date(ms);
  if (date.getUTCFullYear() !== 2025 || date.getUTCMonth() !== 7) return -1;
  return scanned.indexOf(date.getUTCDate());
}

function record(journeys: Journey[], vessel: string) {
  for (const journey of journeys) {
    if (journey.origin.areaId === journey.destination.areaId) continue;
    if (dwellsSameIsland(journey.origin, journey.destination)) {
      sameIslandPassages += 1;
      continue;
    }
    const key = `${journey.origin.areaId}\u0000${journey.destination.areaId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        originId: journey.origin.areaId,
        destinationId: journey.destination.areaId,
        originLabel: journey.origin.areaLabel,
        destinationLabel: journey.destination.areaLabel,
        originLat: journey.origin.areaLat,
        originLon: journey.origin.areaLon,
        destinationLat: journey.destination.areaLat,
        destinationLon: journey.destination.areaLon,
        originConfidence: "inferred",
        destinationConfidence: "inferred",
        originSourceId: null,
        destinationSourceId: null,
        originAtoll: null,
        destinationAtoll: null,
        vessels: new Set(),
        dayCounts: Array.from({ length: scanned.length }, () => 0),
        durationSec: [],
        distanceM: [],
        pathRatio: [],
        excluded: 0,
      };
      groups.set(key, group);
    }
    group.vessels.add(vessel);
    if (rank(journey.origin.confidence) >= rank(group.originConfidence)) {
      group.originConfidence = journey.origin.confidence;
      group.originLabel = journey.origin.islandName ?? journey.origin.placeName ?? journey.origin.areaLabel;
      if (journey.origin.islandName || journey.origin.placeName) group.originLabel = `${journey.origin.islandName ?? journey.origin.placeName} · ${journey.origin.areaLabel}`;
      group.originSourceId = journey.origin.placeSourceId;
      group.originAtoll = journey.origin.atoll;
    }
    if (rank(journey.destination.confidence) >= rank(group.destinationConfidence)) {
      group.destinationConfidence = journey.destination.confidence;
      group.destinationLabel = journey.destination.islandName ?? journey.destination.placeName ?? journey.destination.areaLabel;
      if (journey.destination.islandName || journey.destination.placeName) {
        group.destinationLabel = `${journey.destination.islandName ?? journey.destination.placeName} · ${journey.destination.areaLabel}`;
      }
      group.destinationSourceId = journey.destination.placeSourceId;
      group.destinationAtoll = journey.destination.atoll;
    }
    if (!journey.credible) {
      group.excluded += 1;
      continue;
    }
    const day = augustIndex(journey.destination.startMs);
    if (day >= 0) group.dayCounts[day] += 1;
    group.durationSec.push(Math.round(journey.durationMs / 1000));
    group.distanceM.push(Math.round(journey.straightLineM));
    group.pathRatio.push(Number((journey.straightLineM > 1 ? journey.pathM / journey.straightLineM : 1).toFixed(3)));
  }
}

for (const name of names) {
  const text = await readFile(path.join(directory, name), "utf8");
  const dataset = parseDataset(text, name);
  rowsKept += dataset.kept;
  dayReports.push({ day: name.replace(/\.csv$/i, ""), rowsKept: dataset.kept, devices: dataset.names.length });
  dataset.tracks.forEach((track, device) => {
    const vessel = dataset.names[device];
    devices.add(vessel);
    const carry = carries.get(vessel) ?? emptyCarry();
    const samples = track.map((index) => ({
      timeMs: dataset.timeMs[index],
      lat: dataset.lat[index],
      lon: dataset.lon[index],
      speed: dataset.speed[index],
    }));
    record(ingest(carry, samples, locate, device), vessel);
    carries.set(vessel, carry);
  });
  console.log(`${name} rows=${dataset.kept} devices=${dataset.names.length}`);
}

for (const [vessel, carry] of carries) record(finish(carry, locate, 0), vessel);

const connections: StoredConnection[] = [];
for (const group of groups.values()) {
  if (group.vessels.size < CONNECTIVITY.monthMinVessels) continue;
  connections.push({
    originId: group.originId,
    destinationId: group.destinationId,
    originLabel: group.originLabel,
    destinationLabel: group.destinationLabel,
    originLat: group.originLat,
    originLon: group.originLon,
    destinationLat: group.destinationLat,
    destinationLon: group.destinationLon,
    originConfidence: group.originConfidence,
    destinationConfidence: group.destinationConfidence,
    originSourceId: group.originSourceId,
    destinationSourceId: group.destinationSourceId,
    originAtoll: group.originAtoll,
    destinationAtoll: group.destinationAtoll,
    vessels: group.vessels.size,
    dayCounts: group.dayCounts,
    durationSec: group.durationSec,
    distanceM: group.distanceM,
    pathRatio: group.pathRatio,
    excluded: group.excluded,
  });
}
connections.sort((a, b) => b.durationSec.length - a.durationSec.length || a.originId.localeCompare(b.originId));

const report: StoredMonth & { config: Record<string, number | string>; notes: string[] } = {
  schema: 1,
  periodLabel: "August 2025",
  method: "Credible passage durations are stored in whole seconds and pooled across the month. Median, interquartile range, and 90th percentile are computed from that single list. Daily percentiles are not stored and are not averaged.",
  generatedAt: new Date().toISOString(),
  days: dayReports,
  rowsKept,
  devices: devices.size,
  minVessels: CONNECTIVITY.monthMinVessels,
  sameIslandPassages,
  connections,
  config: {
    stopSpeed: STOP_SPEED_KN,
    dwellMinMs: DWELL_MIN_MS,
    dwellRadiusM: DWELL_RADIUS_M,
    dwellMaxGapMs: DWELL_MAX_GAP_MS,
    implausibleKn: IMPLAUSIBLE_KN,
    sparseGapMs: SPARSE_GAP_MS,
    monthMinVessels: CONNECTIVITY.monthMinVessels,
    harbourMatchM: CONNECTIVITY.harbourMatchM,
    polygons: polygons.length,
    harbours: harbours.length,
  },
  notes: [
    "Cell centres are 0.05 degree activity areas, not harbours.",
    "Passages between cells on the same named island are counted in sameIslandPassages and omitted from connections.",
    "Vessel identities are counted in memory and are not written.",
    "A passage that crosses midnight is emitted once, when the arrival dwell closes.",
    "This file is derived from a private extract. Keep it local unless redistribution is explicitly allowed.",
  ],
};

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(report)}\n`);
console.log(`wrote ${connections.length} connections to ${target}`);

const qualityText = await readOptional(qualityPath);
if (qualityText) {
  const quality = JSON.parse(qualityText) as { rowsKept?: number; devices?: number; fileCount?: number };
  console.log(`quality file rows=${quality.rowsKept} devices=${quality.devices} files=${quality.fileCount}`);
  console.log(`this run rows=${rowsKept} devices=${devices.size} files=${names.length}`);
  if (quality.rowsKept != null && quality.rowsKept !== rowsKept) console.warn("Row count differs from followme-quality.json. Check the parser before treating the summary as confirmed.");
  if (quality.devices != null && quality.devices !== devices.size) console.warn("Device count differs from followme-quality.json.");
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
