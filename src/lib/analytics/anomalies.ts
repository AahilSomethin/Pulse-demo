import { ANOMALY } from "@/config/constants";
import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import { medianAbsoluteDeviation, quantile } from "@/lib/analytics/stats";
import { impliedKnots } from "@/lib/geo/distance";
import { formatDuration } from "@/lib/format";
import { connectionId } from "@/lib/workspace/state";
import type { Journey } from "@/types/maritime";

export type OutlierKind = "stationary" | "slow_direct" | "long_detour" | "unusually_long";
export type AnomalyBaseline = "loaded_day" | "august_summary";
export type TrackedSpeedBasis = "journeys" | "typical_path" | "none";

export interface CohortBaseline {
  id: string;
  durationsMs: readonly number[];
  vessels: number;
  medianDistanceM?: number | null;
  medianPathRatio?: number | null;
}

export interface PassageFlagSummary {
  connectionId: string;
  outliers: number;
  stationary: number;
  slowDirect: number;
  longDetour: number;
  unusuallyLong: number;
  cohortPassages: number;
  cohortVessels: number;
  medianMs: number;
  baseline: AnomalyBaseline;
  /** False when only durations were available, so movement patterns were not separated. */
  movementKnown: boolean;
}

export interface PassageOutlier {
  journeyIndex: number;
  connectionId: string;
  device: number;
  kind: OutlierKind;
  durationMs: number;
  cohortMedianMs: number;
  robustZ: number;
  trackedKn: number;
  pathRatio: number;
  cohortMedianTrackedKn: number | null;
  trackedSpeedBasis: TrackedSpeedBasis;
  deviceMedianMs: number | null;
  cohortPassages: number;
  cohortVessels: number;
  maxGapMs: number;
  pingsBetween: number;
  /** How many ends match an island or harbour name. Unnamed cells stay less useful to open first. */
  namedEnds: number;
  baseline: AnomalyBaseline;
  what: string;
  why: string;
  evidence: string;
  investigate: string;
}

export interface PassageReview {
  outliers: PassageOutlier[];
  byConnection: Map<string, PassageOutlier[]>;
  summaries: Map<string, PassageFlagSummary>;
}

interface Scale {
  medianMs: number;
  madMs: number;
  fenceMs: number;
}

function emptyReview(): PassageReview {
  return { outliers: [], byConnection: new Map(), summaries: new Map() };
}

function journeyConnectionId(journey: Journey): string {
  return connectionId("inferred_activity", journey.origin.areaId, journey.destination.areaId);
}

function pathRatioOf(journey: Journey): number {
  return journey.straightLineM > 1 ? journey.pathM / journey.straightLineM : 1;
}

function scaleOf(durationsMs: readonly number[], vessels: number): Scale | null {
  if (durationsMs.length < ANOMALY.minPassages || vessels < ANOMALY.minVessels) return null;
  const medianMs = quantile(durationsMs, 0.5);
  const madMs = medianAbsoluteDeviation(durationsMs);
  const lower = quantile(durationsMs, 0.25);
  const upper = quantile(durationsMs, 0.75);
  if (medianMs == null || madMs == null || !(madMs > 0) || lower == null || upper == null) return null;
  return { medianMs, madMs, fenceMs: upper + ANOMALY.iqrFence * (upper - lower) };
}

function robustZ(durationMs: number, scale: Scale): number {
  return (ANOMALY.robustScale * (durationMs - scale.medianMs)) / scale.madMs;
}

function approximateTrackedKn(cohort: CohortBaseline, medianMs: number): number | null {
  if (cohort.medianDistanceM == null || cohort.medianPathRatio == null || !(medianMs > 0)) return null;
  if (!(cohort.medianDistanceM > 0)) return null;
  return impliedKnots(cohort.medianDistanceM * cohort.medianPathRatio, medianMs);
}

function kindOf(trackedKn: number, ratio: number, cohortKn: number | null): OutlierKind {
  if (trackedKn < ANOMALY.stationaryKn) return "stationary";
  if (ratio >= ANOMALY.detourPathRatio) return "long_detour";
  if (
    cohortKn != null &&
    ratio < ANOMALY.slowDirectPathRatio &&
    trackedKn <= cohortKn * ANOMALY.slowDirectPaceShare
  ) {
    return "slow_direct";
  }
  return "unusually_long";
}

function namedEnds(journey: Journey): number {
  const named = (name: string | null, place: string | null) => (name || place ? 1 : 0);
  return named(journey.origin.islandName, journey.origin.placeName) + named(journey.destination.islandName, journey.destination.placeName);
}

function ends(journey: Journey): string {
  const from = journey.origin.islandName ?? journey.origin.placeName;
  const to = journey.destination.islandName ?? journey.destination.placeName;
  if (from && to) return `from ${from} to ${to}`;
  return "between these activity areas";
}

function whyFor(kind: OutlierKind, trackedKn: number, ratio: number, cohortKn: number | null): string {
  if (kind === "stationary") {
    return `The tracked distance over that time is about ${trackedKn.toFixed(1)} knots, under ${ANOMALY.stationaryKn} knots. Most of the clock the vessel was barely moving. This figure uses the positions and the clock, not the speed column.`;
  }
  if (kind === "long_detour") {
    return `The tracked path is ${ratio.toFixed(1)} times the straight-line separation, and the rule flags ${ANOMALY.detourPathRatio} times or more. The extra time comes with a much longer track.`;
  }
  if (kind === "slow_direct") {
    const usual = cohortKn == null ? "the usual pace" : `about ${cohortKn.toFixed(1)} knots`;
    return `The path stays close to the straight-line separation (${ratio.toFixed(1)} times it), but the tracked pace is about ${trackedKn.toFixed(1)} knots, at most half of ${usual}. Both figures are distance over time.`;
  }
  return "The time is far above the usual spread, but the track is neither a near-stop nor a much longer path. The extra time is not explained by those two patterns.";
}

function investigateFor(kind: OutlierKind): string {
  if (kind === "stationary") {
    return "Replay the passage and watch the reported speed. A long pause can be waiting or mooring, or a stop the dwell rule missed because the speed flickered or the position drifted. This is not evidence of a breakdown or a missed service.";
  }
  if (kind === "slow_direct") {
    return "Replay the passage. If this device’s own typical time is close to this journey, it may be a slower vessel on the same connection. The file has no vessel type. This is not a confirmed delay.";
  }
  if (kind === "long_detour") {
    return "Replay the passage. The vessel may have called somewhere else, or the track may wander. A straight line is not a channel. This is not proof of a diversion.";
  }
  return "Replay the passage and check the longest gap between reports before reading the extra time as slower travel. This is not a confirmed delay.";
}

function evidenceText(input: {
  passages: number;
  vessels: number;
  baseline: AnomalyBaseline;
  robustZ: number;
  trackedKn: number;
  ratio: number;
  maxGapMs: number;
  deviceMedianMs: number | null;
  devicePassages: number;
  trackedSpeedBasis: TrackedSpeedBasis;
  cohortKn: number | null;
}): string {
  const where = input.baseline === "august_summary" ? "The comparison uses the August summary" : "The comparison uses this loaded day";
  const pace = input.trackedSpeedBasis === "typical_path" && input.cohortKn != null
    ? ` Typical pace is estimated from the typical path and the typical time, about ${input.cohortKn.toFixed(1)} knots.`
    : input.trackedSpeedBasis === "journeys" && input.cohortKn != null
      ? ` The median tracked pace of the journeys in this comparison is about ${input.cohortKn.toFixed(1)} knots.`
      : "";
  const gap = input.maxGapMs < 60_000 ? "under 1 min" : formatDuration(input.maxGapMs);
  const self = input.devicePassages >= ANOMALY.minDevicePassages && input.deviceMedianMs != null
    ? ` This device’s own journeys here typically take ${formatDuration(input.deviceMedianMs)}.`
    : " This device has fewer than 3 journeys on this connection, so it is not compared with itself.";
  return `${where}: ${input.passages} journeys from ${input.vessels} vessels. The robust score is ${input.robustZ.toFixed(1)}, flagged above ${ANOMALY.robustZ}. Tracked pace was about ${input.trackedKn.toFixed(1)} knots. The path was ${input.ratio.toFixed(1)} times the straight-line separation. The longest gap between reports was ${gap}.${pace}${self}`;
}

function explain(journey: Journey, kind: OutlierKind, scale: Scale, z: number, trackedKn: number, ratio: number, cohortKn: number | null, basis: TrackedSpeedBasis, deviceMedianMs: number | null, devicePassages: number, passages: number, vessels: number, baseline: AnomalyBaseline): Pick<PassageOutlier, "what" | "why" | "evidence" | "investigate"> {
  return {
    what: `The journey ${ends(journey)} took ${formatDuration(journey.durationMs)}. The typical journey on this connection takes ${formatDuration(scale.medianMs)}.`,
    why: whyFor(kind, trackedKn, ratio, cohortKn),
    evidence: evidenceText({
      passages,
      vessels,
      baseline,
      robustZ: z,
      trackedKn,
      ratio,
      maxGapMs: journey.maxGapMs,
      deviceMedianMs,
      devicePassages,
      trackedSpeedBasis: basis,
      cohortKn,
    }),
    investigate: investigateFor(kind),
  };
}

function emptySummary(id: string, scale: Scale, passages: number, vessels: number, baseline: AnomalyBaseline, movementKnown: boolean): PassageFlagSummary {
  return {
    connectionId: id,
    outliers: 0,
    stationary: 0,
    slowDirect: 0,
    longDetour: 0,
    unusuallyLong: 0,
    cohortPassages: passages,
    cohortVessels: vessels,
    medianMs: scale.medianMs,
    baseline,
    movementKnown,
  };
}

function addKind(summary: PassageFlagSummary, kind: OutlierKind) {
  summary.outliers += 1;
  if (kind === "stationary") summary.stationary += 1;
  else if (kind === "slow_direct") summary.slowDirect += 1;
  else if (kind === "long_detour") summary.longDetour += 1;
  else summary.unusuallyLong += 1;
}

/** A connection is worth ranking when at least two journeys clear both fences. */
export function cohortFromIndicator(indicator: ConnectionIndicator): CohortBaseline | null {
  if (indicator.evidence !== "adequate") return null;
  if (indicator.durationsMs.length < ANOMALY.minPassages || indicator.vessels < ANOMALY.minVessels) return null;
  return {
    id: indicator.id,
    durationsMs: indicator.durationsMs,
    vessels: indicator.vessels,
    medianDistanceM: indicator.medianDistanceM,
    medianPathRatio: indicator.medianPathRatio,
  };
}

/**
 * Scores credible journeys against a cohort. A supplied cohort, usually the August
 * summary, is the baseline when it is large enough. Otherwise the loaded day is
 * used, and only when that day itself has enough journeys and vessels.
 * A median absolute deviation of zero flags nothing.
 */
export function findPassageOutliers(journeys: readonly Journey[], cohorts: readonly CohortBaseline[] = []): PassageReview {
  if (journeys.length === 0) return emptyReview();
  const supplied = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
  const groups = new Map<string, { index: number; journey: Journey }[]>();
  journeys.forEach((journey, index) => {
    if (!journey.credible) return;
    const id = journeyConnectionId(journey);
    const list = groups.get(id);
    if (list) list.push({ index, journey });
    else groups.set(id, [{ index, journey }]);
  });

  const outliers: PassageOutlier[] = [];
  const byConnection = new Map<string, PassageOutlier[]>();
  const summaries = new Map<string, PassageFlagSummary>();

  for (const [id, group] of groups) {
    const devices = new Set(group.map((item) => item.journey.device));
    const localDurations = group.map((item) => item.journey.durationMs);
    const cohort = supplied.get(id);
    const suppliedScale = cohort ? scaleOf(cohort.durationsMs, cohort.vessels) : null;
    const localScale = scaleOf(localDurations, devices.size);
    const scale = suppliedScale ?? localScale;
    if (!scale) continue;
    const baseline: AnomalyBaseline = suppliedScale ? "august_summary" : "loaded_day";
    const passages = suppliedScale && cohort ? cohort.durationsMs.length : localDurations.length;
    const vessels = suppliedScale && cohort ? cohort.vessels : devices.size;

    let cohortKn: number | null = null;
    let basis: TrackedSpeedBasis = "none";
    if (baseline === "loaded_day") {
      const paces = group.map((item) => impliedKnots(item.journey.pathM, item.journey.durationMs));
      cohortKn = quantile(paces, 0.5);
      basis = cohortKn == null ? "none" : "journeys";
    } else if (cohort) {
      cohortKn = approximateTrackedKn(cohort, scale.medianMs);
      basis = cohortKn == null ? "none" : "typical_path";
    }

    const byDevice = new Map<number, number[]>();
    for (const item of group) {
      const list = byDevice.get(item.journey.device);
      if (list) list.push(item.journey.durationMs);
      else byDevice.set(item.journey.device, [item.journey.durationMs]);
    }

    const summary = emptySummary(id, scale, passages, vessels, baseline, true);
    const rows: PassageOutlier[] = [];
    for (const item of group) {
      const z = robustZ(item.journey.durationMs, scale);
      if (!(z > ANOMALY.robustZ) || !(item.journey.durationMs > scale.fenceMs)) continue;
      const trackedKn = impliedKnots(item.journey.pathM, item.journey.durationMs);
      const ratio = pathRatioOf(item.journey);
      const kind = kindOf(trackedKn, ratio, cohortKn);
      const own = byDevice.get(item.journey.device) ?? [];
      const deviceMedianMs = own.length >= ANOMALY.minDevicePassages ? quantile(own, 0.5) : null;
      const text = explain(item.journey, kind, scale, z, trackedKn, ratio, cohortKn, basis, deviceMedianMs, own.length, passages, vessels, baseline);
      rows.push({
        journeyIndex: item.index,
        connectionId: id,
        device: item.journey.device,
        kind,
        durationMs: item.journey.durationMs,
        cohortMedianMs: scale.medianMs,
        robustZ: z,
        trackedKn,
        pathRatio: ratio,
        cohortMedianTrackedKn: cohortKn,
        trackedSpeedBasis: basis,
        deviceMedianMs,
        cohortPassages: passages,
        cohortVessels: vessels,
        maxGapMs: item.journey.maxGapMs,
        pingsBetween: item.journey.pingsBetween,
        namedEnds: namedEnds(item.journey),
        baseline,
        ...text,
      });
      addKind(summary, kind);
    }
    if (rows.length === 0) continue;
    rows.sort((a, b) => b.robustZ - a.robustZ || a.journeyIndex - b.journeyIndex);
    outliers.push(...rows);
    byConnection.set(id, rows);
    summaries.set(id, summary);
  }

  outliers.sort((a, b) => b.robustZ - a.robustZ || a.connectionId.localeCompare(b.connectionId));
  return { outliers, byConnection, summaries };
}

/** Duration-only count for the August summary, which does not keep each path. */
export function summariesFromDurations(indicators: readonly ConnectionIndicator[]): Map<string, PassageFlagSummary> {
  const summaries = new Map<string, PassageFlagSummary>();
  for (const indicator of indicators) {
    const scale = scaleOf(indicator.durationsMs, indicator.vessels);
    if (!scale || indicator.evidence !== "adequate") continue;
    const summary = emptySummary(indicator.id, scale, indicator.durationsMs.length, indicator.vessels, "august_summary", false);
    for (const durationMs of indicator.durationsMs) {
      const z = robustZ(durationMs, scale);
      if (z > ANOMALY.robustZ && durationMs > scale.fenceMs) addKind(summary, "unusually_long");
    }
    if (summary.outliers > 0) summaries.set(indicator.id, summary);
  }
  return summaries;
}

export function tallyPassageFlags(summaries: Iterable<PassageFlagSummary>): {
  connections: number;
  outliers: number;
  stationary: number;
  slowDirect: number;
  longDetour: number;
  unusuallyLong: number;
  movementKnown: boolean;
} {
  const tally = {
    connections: 0,
    outliers: 0,
    stationary: 0,
    slowDirect: 0,
    longDetour: 0,
    unusuallyLong: 0,
    movementKnown: true,
  };
  for (const summary of summaries) {
    if (summary.outliers < ANOMALY.minOutliers) continue;
    tally.connections += 1;
    tally.outliers += summary.outliers;
    tally.stationary += summary.stationary;
    tally.slowDirect += summary.slowDirect;
    tally.longDetour += summary.longDetour;
    tally.unusuallyLong += summary.unusuallyLong;
    if (!summary.movementKnown) tally.movementKnown = false;
  }
  return tally;
}
