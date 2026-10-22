import { CONNECTIVITY, DWELL_MAX_GAP_MS, DWELL_MIN_MS, DWELL_RADIUS_M, IMPLAUSIBLE_KN, STOP_SPEED_KN, AREA_CELL_DEG } from "@/config/constants";
import { createPlaceLocator, type PlaceLocator } from "@/lib/geo/matching";
import { distanceM, impliedKnots } from "@/lib/geo/distance";
import type { Dwell, HarbourPoint, Journey, LandPolygon, PassageFlag, VesselDataset } from "@/types/maritime";

export interface TrackSample {
  timeMs: number;
  lat: number;
  lon: number;
  speed: number;
}

interface OpenRun {
  startMs: number;
  endMs: number;
  latSum: number;
  lonSum: number;
  count: number;
  anchorLat: number;
  anchorLon: number;
  firstLat: number;
  firstLon: number;
  firstMs: number;
  lastLat: number;
  lastLon: number;
  pathM: number;
  maxGapMs: number;
}

interface PathState {
  ready: boolean;
  lastLat: number;
  lastLon: number;
  lastMs: number;
  pathM: number;
  pings: number;
  maxGapMs: number;
}

export interface PassageCarry {
  run: OpenRun | null;
  last: Dwell | null;
  path: PathState;
}

export function emptyCarry(): PassageCarry {
  return {
    run: null,
    last: null,
    path: { ready: false, lastLat: 0, lastLon: 0, lastMs: 0, pathM: 0, pings: 0, maxGapMs: 0 },
  };
}

function startRun(sample: TrackSample): OpenRun {
  return {
    startMs: sample.timeMs,
    endMs: sample.timeMs,
    latSum: sample.lat,
    lonSum: sample.lon,
    count: 1,
    anchorLat: sample.lat,
    anchorLon: sample.lon,
    firstLat: sample.lat,
    firstLon: sample.lon,
    firstMs: sample.timeMs,
    lastLat: sample.lat,
    lastLon: sample.lon,
    pathM: 0,
    maxGapMs: 0,
  };
}

function continues(run: OpenRun, sample: TrackSample): boolean {
  if (sample.speed >= STOP_SPEED_KN) return false;
  const gap = sample.timeMs - run.endMs;
  if (gap > DWELL_MAX_GAP_MS) return false;
  if (distanceM(run.lastLon, run.lastLat, sample.lon, sample.lat) > DWELL_RADIUS_M) return false;
  return distanceM(run.anchorLon, run.anchorLat, sample.lon, sample.lat) <= DWELL_RADIUS_M;
}

function extendRun(run: OpenRun, sample: TrackSample) {
  const gap = sample.timeMs - run.endMs;
  run.pathM += distanceM(run.lastLon, run.lastLat, sample.lon, sample.lat);
  run.maxGapMs = Math.max(run.maxGapMs, gap);
  run.endMs = sample.timeMs;
  run.lastLat = sample.lat;
  run.lastLon = sample.lon;
  run.latSum += sample.lat;
  run.lonSum += sample.lon;
  run.count += 1;
}

function isDwell(run: OpenRun): boolean {
  return run.count >= 2 && run.endMs - run.startMs >= DWELL_MIN_MS;
}

function pushPoint(path: PathState, sample: TrackSample, countAsBetween: boolean) {
  if (!path.ready) {
    path.ready = true;
    path.lastLat = sample.lat;
    path.lastLon = sample.lon;
    path.lastMs = sample.timeMs;
    return;
  }
  const gap = sample.timeMs - path.lastMs;
  if (gap > path.maxGapMs) path.maxGapMs = gap;
  path.pathM += distanceM(path.lastLon, path.lastLat, sample.lon, sample.lat);
  if (countAsBetween) path.pings += 1;
  path.lastLat = sample.lat;
  path.lastLon = sample.lon;
  path.lastMs = sample.timeMs;
}

/** A slow run that never became a dwell still belongs to the movement between stops. */
function absorbFailedRun(path: PathState, run: OpenRun) {
  pushPoint(path, { timeMs: run.firstMs, lat: run.firstLat, lon: run.firstLon, speed: 0 }, true);
  path.pathM += run.pathM;
  path.maxGapMs = Math.max(path.maxGapMs, run.maxGapMs);
  path.pings += run.count - 1;
  path.lastLat = run.lastLat;
  path.lastLon = run.lastLon;
  path.lastMs = run.endMs;
  path.ready = true;
}

function activityCell(lat: number, lon: number) {
  const fx = Math.floor(lon / AREA_CELL_DEG);
  const fy = Math.floor(lat / AREA_CELL_DEG);
  return {
    id: `${fy}:${fx}`,
    label: `Inferred area ${((fy + 0.5) * AREA_CELL_DEG).toFixed(2)}°N, ${((fx + 0.5) * AREA_CELL_DEG).toFixed(2)}°E`,
    lat: (fy + 0.5) * AREA_CELL_DEG,
    lon: (fx + 0.5) * AREA_CELL_DEG,
  };
}
function dwellFromRun(run: OpenRun, device: number, locate: PlaceLocator): Dwell {
  const lat = run.latSum / run.count;
  const lon = run.lonSum / run.count;
  const area = activityCell(lat, lon);
  const match = locate.locate(lat, lon);
  return {
    device,
    startMs: run.startMs,
    endMs: run.endMs,
    lat,
    lon,
    pingCount: run.count,
    islandId: match.islandId,
    islandName: match.islandName,
    areaId: area.id,
    areaLabel: area.label,
    areaLat: area.lat,
    areaLon: area.lon,
    atoll: match.atoll,
    confidence: match.confidence,
    placeName: match.harbourName,
    placeSourceId: match.harbourId ?? match.islandId,
  };
}

function measure(path: PathState, run: OpenRun): { pathM: number; pingsBetween: number; maxGapMs: number } {
  const copy: PathState = { ...path };
  pushPoint(copy, { timeMs: run.firstMs, lat: run.firstLat, lon: run.firstLon, speed: 0 }, false);
  return { pathM: copy.pathM, pingsBetween: copy.pings, maxGapMs: copy.maxGapMs };
}

function anchorAt(run: OpenRun): PathState {
  return {
    ready: true,
    lastLat: run.lastLat,
    lastLon: run.lastLon,
    lastMs: run.endMs,
    pathM: 0,
    pings: 0,
    maxGapMs: 0,
  };
}

function toJourney(device: number, origin: Dwell, destination: Dwell, measured: { pathM: number; pingsBetween: number; maxGapMs: number }): Journey {
  const durationMs = destination.startMs - origin.endMs;
  const straightLineM = distanceM(origin.lon, origin.lat, destination.lon, destination.lat);
  const impliedKn = impliedKnots(straightLineM, durationMs);
  const flags: PassageFlag[] = [];
  if (!(durationMs > 0)) flags.push("clock_static");
  if (impliedKn > IMPLAUSIBLE_KN) flags.push("implausible_speed");
  if (measured.maxGapMs > CONNECTIVITY.sparseGapMs) flags.push("sparse_tracking");
  if (origin.areaId === destination.areaId) flags.push("same_area");
  const coverageGap = flags.includes("clock_static") || flags.includes("implausible_speed");
  return {
    device,
    origin,
    destination,
    durationMs,
    straightLineM,
    pathM: measured.pathM,
    pingsBetween: measured.pingsBetween,
    maxGapMs: measured.maxGapMs,
    impliedKn,
    flags,
    coverageGap,
    credible: flags.length === 0,
  };
}

/**
 * Advances one vessel. An open dwell and the points since the last closed dwell
 * stay on the carry, so a later day can finish them without emitting a second journey.
 * `device` is stored on the dwell; the caller chooses a stable id inside one file.
 */
export function ingest(carry: PassageCarry, samples: readonly TrackSample[], locate: PlaceLocator, device = 0): Journey[] {
  const journeys: Journey[] = [];
  const closeRun = () => {
    const run = carry.run;
    if (!run) return;
    carry.run = null;
    if (!isDwell(run)) {
      if (carry.last) absorbFailedRun(carry.path, run);
      return;
    }
    const dwell = dwellFromRun(run, device, locate);
    if (carry.last) journeys.push(toJourney(device, carry.last, dwell, measure(carry.path, run)));
    carry.last = dwell;
    carry.path = anchorAt(run);
  };

  for (const sample of samples) {
    if (carry.run && continues(carry.run, sample)) {
      extendRun(carry.run, sample);
      continue;
    }
    closeRun();
    if (sample.speed < STOP_SPEED_KN) carry.run = startRun(sample);
    else if (carry.last) pushPoint(carry.path, sample, true);
  }
  return journeys;
}

/** Closes a dwell that is still open at the end of the series. Does not invent a journey after it. */
export function finish(carry: PassageCarry, locate: PlaceLocator, device = 0): Journey[] {
  return ingest(carry, [], locate, device).concat(closeOpen(carry, locate, device));
}

function closeOpen(carry: PassageCarry, locate: PlaceLocator, device: number): Journey[] {
  const run = carry.run;
  if (!run) return [];
  carry.run = null;
  if (!isDwell(run)) return [];
  const dwell = dwellFromRun(run, device, locate);
  const journeys = carry.last ? [toJourney(device, carry.last, dwell, measure(carry.path, run))] : [];
  carry.last = dwell;
  carry.path = anchorAt(run);
  return journeys;
}

export function passagesFromDataset(
  dataset: VesselDataset,
  polygons: readonly LandPolygon[],
  harbours: readonly HarbourPoint[] = [],
): Journey[] {
  const locate = createPlaceLocator(polygons, harbours);
  const journeys: Journey[] = [];
  dataset.tracks.forEach((track, device) => {
    const carry = emptyCarry();
    const samples = track.map((index) => ({
      timeMs: dataset.timeMs[index],
      lat: dataset.lat[index],
      lon: dataset.lon[index],
      speed: dataset.speed[index],
    }));
    journeys.push(...ingest(carry, samples, locate, device));
    journeys.push(...finish(carry, locate, device));
  });
  return journeys;
}
