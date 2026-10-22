import { IMPLAUSIBLE_KN, STOP_SPEED_KN } from "@/config/constants";
import { distanceM, impliedKnots } from "@/lib/geo/distance";
import { median } from "@/lib/format";
import type { ParsedColumns, CsvParseResult } from "@/lib/parsing/csv";
import type { DatasetQuality, VesselDataset } from "@/types/maritime";

export function periodLabel(t0: number, t1: number): string {
  const start = new Date(t0);
  const end = new Date(t1);
  if (start.getUTCFullYear() === 2025 && end.getUTCFullYear() === 2025 && start.getUTCMonth() === 7 && end.getUTCMonth() === 7) {
    return "August 2025";
  }
  return "";
}

interface ColumnInput {
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
  rejected: VesselDataset["rejected"];
  minuteMarks: number;
  hasTimestamp: boolean;
  hasHeading: boolean;
  hasNetwork: boolean;
  hasGsm: boolean;
}

function emptyQuality(): DatasetQuality {
  return {
    duplicateRows: 0,
    zeroDurationMoves: 0,
    implausibleJumps: 0,
    identicalConsecutive: 0,
    minuteQuantizedShare: null,
    medianLagSec: null,
    medianIntervalSec: null,
    medianMovingKn: null,
    maxSpeed: 0,
    headingVaries: false,
    network: { dhiraagu: 0, ooredoo: 0, other: 0, missing: 0 },
    gsmKnown: 0,
  };
}

export function buildDatasetFromColumns(columns: ColumnInput, sourceLabel: string): VesselDataset {
  const count = columns.timeMs.length;
  if (count === 0) throw new Error("No valid rows found. Check the column names.");
  const tracks: number[][] = columns.names.map(() => []);
  let minLat = 99;
  let maxLat = -99;
  let minLon = 999;
  let maxLon = -999;
  const quality = emptyQuality();
  quality.duplicateRows = columns.rejected.duplicate;
  const moving: number[] = [];
  const intervals: number[] = [];
  const lags: number[] = [];
  let headingMin = Number.POSITIVE_INFINITY;
  let headingMax = Number.NEGATIVE_INFINITY;
  let headingSeen = 0;
  const last = columns.names.map(() => -1);

  for (let index = 0; index < count; index += 1) {
    const device = columns.deviceIndex[index];
    tracks[device].push(index);
    minLat = Math.min(minLat, columns.lat[index]);
    maxLat = Math.max(maxLat, columns.lat[index]);
    minLon = Math.min(minLon, columns.lon[index]);
    maxLon = Math.max(maxLon, columns.lon[index]);
    if (columns.speed[index] > quality.maxSpeed) quality.maxSpeed = columns.speed[index];
    if (columns.speed[index] >= STOP_SPEED_KN) moving.push(columns.speed[index]);
    if (columns.hasNetwork) {
      const code = columns.network[index];
      if (code === 1) quality.network.dhiraagu += 1;
      else if (code === 2) quality.network.ooredoo += 1;
      else if (code < 0) quality.network.missing += 1;
      else quality.network.other += 1;
    }
    if (columns.hasGsm && columns.gsm[index] >= 0) quality.gsmKnown += 1;
    if (columns.hasHeading && columns.heading[index] >= 0) {
      headingSeen += 1;
      headingMin = Math.min(headingMin, columns.heading[index]);
      headingMax = Math.max(headingMax, columns.heading[index]);
    }
    if (columns.hasTimestamp) lags.push((columns.savedMs[index] - columns.timeMs[index]) / 1000);
    const previous = last[device];
    if (previous >= 0) {
      const duration = columns.timeMs[index] - columns.timeMs[previous];
      const meters = distanceM(columns.lon[previous], columns.lat[previous], columns.lon[index], columns.lat[index]);
      if (duration === 0 && meters >= 1) quality.zeroDurationMoves += 1;
      else if (duration > 0) {
        intervals.push(duration / 1000);
        if (meters < 1) quality.identicalConsecutive += 1;
        else if (impliedKnots(meters, duration) > IMPLAUSIBLE_KN) quality.implausibleJumps += 1;
      }
    }
    last[device] = index;
  }

  quality.minuteQuantizedShare = count === 0 ? null : columns.minuteMarks / count;
  quality.medianLagSec = columns.hasTimestamp ? median(lags) : null;
  quality.medianIntervalSec = median(intervals);
  quality.medianMovingKn = median(moving);
  quality.headingVaries = headingSeen > 0 && headingMin !== headingMax;

  return {
    timeMs: columns.timeMs,
    savedMs: columns.savedMs,
    lat: columns.lat,
    lon: columns.lon,
    speed: columns.speed,
    heading: columns.heading,
    network: columns.network,
    gsm: columns.gsm,
    deviceIndex: columns.deviceIndex,
    names: columns.names,
    tracks,
    t0: columns.timeMs[0],
    t1: columns.timeMs[count - 1],
    bounds: { minLat, maxLat, minLon, maxLon },
    rejected: columns.rejected,
    kept: count,
    sourceLabel,
    synthetic: /synthetic/i.test(sourceLabel),
    periodLabel: periodLabel(columns.timeMs[0], columns.timeMs[count - 1]),
    quality,
  };
}

export function buildDatasetFromPrepared(columns: ParsedColumns, sourceLabel: string): VesselDataset {
  return buildDatasetFromColumns(columns, sourceLabel);
}

export function buildDataset(parsed: CsvParseResult, sourceLabel: string): VesselDataset {
  const count = parsed.rows.length;
  const timeMs = new Float64Array(count);
  const savedMs = new Float64Array(count);
  const lat = new Float32Array(count);
  const lon = new Float32Array(count);
  const speed = new Float32Array(count);
  const heading = new Int16Array(count);
  const network = new Int8Array(count);
  const gsm = new Int16Array(count);
  const deviceIndex = new Int32Array(count);
  const ids = new Map<string, number>();
  const names: string[] = [];
  parsed.rows.forEach((row, index) => {
    timeMs[index] = row.timeMs;
    savedMs[index] = row.savedMs;
    lat[index] = row.lat;
    lon[index] = row.lon;
    speed[index] = row.speed;
    heading[index] = row.heading;
    network[index] = row.network;
    gsm[index] = row.gsm;
    let device = ids.get(row.imei);
    if (device === undefined) {
      device = names.length;
      ids.set(row.imei, device);
      names.push(row.imei);
    }
    deviceIndex[index] = device;
  });
  return buildDatasetFromColumns(
    {
      timeMs,
      savedMs,
      lat,
      lon,
      speed,
      heading,
      network,
      gsm,
      deviceIndex,
      names,
      rejected: parsed.rejected,
      minuteMarks: parsed.minuteMarks,
      hasTimestamp: parsed.hasTimestamp,
      hasHeading: parsed.hasHeading,
      hasNetwork: parsed.hasNetwork,
      hasGsm: parsed.hasGsm,
    },
    sourceLabel,
  );
}

export interface DatasetMessage {
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
  tracks: number[][];
  t0: number;
  t1: number;
  bounds: VesselDataset["bounds"];
  rejected: VesselDataset["rejected"];
  kept: number;
  sourceLabel: string;
  periodLabel: string;
  quality: DatasetQuality;
}

export function toMessage(dataset: VesselDataset): DatasetMessage {
  return {
    timeMs: dataset.timeMs,
    savedMs: dataset.savedMs,
    lat: dataset.lat,
    lon: dataset.lon,
    speed: dataset.speed,
    heading: dataset.heading,
    network: dataset.network,
    gsm: dataset.gsm,
    deviceIndex: dataset.deviceIndex,
    names: dataset.names,
    tracks: dataset.tracks,
    t0: dataset.t0,
    t1: dataset.t1,
    bounds: dataset.bounds,
    rejected: dataset.rejected,
    kept: dataset.kept,
    sourceLabel: dataset.sourceLabel,
    periodLabel: dataset.periodLabel,
    quality: dataset.quality,
  };
}

export function fromMessage(message: DatasetMessage): VesselDataset {
  return { ...message, synthetic: /synthetic/i.test(message.sourceLabel) };
}
