import { ANOMALY, IMPLAUSIBLE_KN } from "@/config/constants";
import { quantile } from "@/lib/analytics/stats";
import { distanceM, impliedKnots } from "@/lib/geo/distance";
import type { VesselDataset } from "@/types/maritime";

export interface TrackPoint {
  timeMs: number;
  lat: number;
  lon: number;
  speed: number;
}

/** Counts of straight-line jumps. `outAndBack` can overlap the other three, which sum to `examined`. */
export interface JumpClassification {
  examined: number;
  fastReported: number;
  positionJump: number;
  other: number;
  outAndBack: number;
}

export interface LowRateCount {
  devicesWithGaps: number;
  lowRate: number;
}

function emptyJumps(): JumpClassification {
  return { examined: 0, fastReported: 0, positionJump: 0, other: 0, outAndBack: 0 };
}

function notePair(result: JumpClassification, previous: TrackPoint, current: TrackPoint, next: TrackPoint | null) {
  const duration = current.timeMs - previous.timeMs;
  if (!(duration > 0)) return;
  const meters = distanceM(previous.lon, previous.lat, current.lon, current.lat);
  if (!(meters > ANOMALY.jumpMinM) || !(impliedKnots(meters, duration) > IMPLAUSIBLE_KN)) return;
  result.examined += 1;
  const reported = Math.max(previous.speed, current.speed);
  if (reported >= ANOMALY.fastReported) result.fastReported += 1;
  else if (reported < ANOMALY.contradictedReported) result.positionJump += 1;
  else result.other += 1;
  if (next) {
    const back = distanceM(previous.lon, previous.lat, next.lon, next.lat);
    if (back < meters * ANOMALY.outAndBackShare) result.outAndBack += 1;
  }
}

/** Classifies a time-ordered track. A jump under 200 m is left in the existing 40-knot count and is not reclassified here. */
export function classifyTrack(points: readonly TrackPoint[]): JumpClassification {
  const result = emptyJumps();
  for (let index = 1; index < points.length; index += 1) {
    notePair(result, points[index - 1], points[index], points[index + 1] ?? null);
  }
  return result;
}

export function classifyDataset(dataset: VesselDataset, device?: number): JumpClassification {
  const result = emptyJumps();
  const tracks = device == null ? dataset.tracks : [dataset.tracks[device] ?? []];
  for (const track of tracks) {
    for (let index = 1; index < track.length; index += 1) {
      const previous = track[index - 1];
      const current = track[index];
      const next = track[index + 1];
      notePair(
        result,
        { timeMs: dataset.timeMs[previous], lat: dataset.lat[previous], lon: dataset.lon[previous], speed: dataset.speed[previous] },
        { timeMs: dataset.timeMs[current], lat: dataset.lat[current], lon: dataset.lon[current], speed: dataset.speed[current] },
        next == null ? null : { timeMs: dataset.timeMs[next], lat: dataset.lat[next], lon: dataset.lon[next], speed: dataset.speed[next] },
      );
    }
  }
  return result;
}

/** Median gap in seconds. Null when the device has no positive interval. */
export function medianGapSec(timesMs: readonly number[]): number | null {
  const gaps: number[] = [];
  for (let index = 1; index < timesMs.length; index += 1) {
    const gap = (timesMs[index] - timesMs[index - 1]) / 1000;
    if (gap > 0) gaps.push(gap);
  }
  return quantile(gaps, 0.5);
}

export function countLowRateDevices(dataset: VesselDataset): LowRateCount {
  let devicesWithGaps = 0;
  let lowRate = 0;
  for (const track of dataset.tracks) {
    const times: number[] = [];
    for (let index = 1; index < track.length; index += 1) {
      const gap = (dataset.timeMs[track[index]] - dataset.timeMs[track[index - 1]]) / 1000;
      if (gap > 0) times.push(gap);
    }
    const mid = quantile(times, 0.5);
    if (mid == null) continue;
    devicesWithGaps += 1;
    if (mid >= ANOMALY.lowRateMedianSec) lowRate += 1;
  }
  return { devicesWithGaps, lowRate };
}
