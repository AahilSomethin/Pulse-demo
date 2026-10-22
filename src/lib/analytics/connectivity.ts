import { CONNECTIVITY } from "@/config/constants";
import { dwellsSameIsland } from "@/lib/analytics/same-island";
import { coefficientOfVariation, quantile, quartileRange } from "@/lib/analytics/stats";
import { connectionId } from "@/lib/workspace/state";
import type { GeoConfidence, Journey } from "@/types/maritime";

export type EvidenceLevel = "insufficient" | "limited" | "adequate";
export type IndicatorScope = "day" | "month";

export interface ConnectionEndpoint {
  id: string;
  label: string;
  lat: number;
  lon: number;
  confidence: GeoConfidence;
  sourceId: string | null;
  atoll: string | null;
}

export interface ConnectionIndicator {
  id: string;
  origin: ConnectionEndpoint;
  destination: ConnectionEndpoint;
  /** Credible passages only. */
  passages: number;
  /** Distinct devices on any passage between the cells, including flagged ones. */
  vessels: number;
  /** Devices with at least one credible passage. Null when the source cannot separate them. */
  credibleVessels: number | null;
  /** Credible plus flagged passages between these areas. */
  attempted: number;
  /** Flagged passages kept out of the duration distribution. */
  excluded: number;
  activeDays: number;
  /** Credible passages per observation day. Length is the observation window, including zeros. */
  dayCounts: number[];
  /** Credible durations in milliseconds. The distribution itself, not daily summaries. */
  durationsMs: number[];
  medianDurationMs: number | null;
  iqrMs: number | null;
  p90Ms: number | null;
  medianDistanceM: number | null;
  medianPathRatio: number | null;
  evidence: EvidenceLevel;
  scope: IndicatorScope;
  periodLabel: string;
  observationDays: number;
}

export interface IndicatorBuildOptions {
  scope: IndicatorScope;
  periodLabel: string;
  observationDays: number;
  /** When set, dayCounts is aligned to this index for each journey. */
  dayIndex?: (journey: Journey) => number;
  vesselKey?: (journey: Journey) => string;
}

function evidenceFor(passages: number, vessels: number): EvidenceLevel {
  if (passages >= CONNECTIVITY.minPassagesAdequate && vessels >= CONNECTIVITY.minVesselsAdequate) return "adequate";
  if (passages >= CONNECTIVITY.minPassagesLimited && vessels >= CONNECTIVITY.minVesselsLimited) return "limited";
  return "insufficient";
}

function endpointOf(journey: Journey, end: "origin" | "destination"): ConnectionEndpoint {
  const dwell = journey[end];
  const confidence: GeoConfidence = dwell.confidence ?? (dwell.islandName ? "named_polygon" : "inferred");
  const named = dwell.islandName ?? dwell.placeName;
  return {
    id: dwell.areaId,
    label: named ? `${named} · ${dwell.areaLabel}` : dwell.areaLabel,
    lat: dwell.areaLat,
    lon: dwell.areaLon,
    confidence,
    sourceId: dwell.placeSourceId ?? dwell.islandId,
    atoll: dwell.atoll,
  };
}

interface Group {
  origin: ConnectionEndpoint;
  destination: ConnectionEndpoint;
  vessels: Set<string>;
  credibleVessels: Set<string>;
  attempted: number;
  excluded: number;
  durationsMs: number[];
  distances: number[];
  ratios: number[];
  dayCounts: number[];
}

function emptyGroup(origin: ConnectionEndpoint, destination: ConnectionEndpoint, days: number): Group {
  return {
    origin,
    destination,
    vessels: new Set(),
    credibleVessels: new Set(),
    attempted: 0,
    excluded: 0,
    durationsMs: [],
    distances: [],
    ratios: [],
    dayCounts: Array.from({ length: days }, () => 0),
  };
}

export function buildConnectionIndicators(journeys: readonly Journey[], options: IndicatorBuildOptions): ConnectionIndicator[] {
  const days = Math.max(1, options.observationDays);
  const groups = new Map<string, Group>();
  for (const journey of journeys) {
    if (journey.origin.areaId === journey.destination.areaId) continue;
    if (dwellsSameIsland(journey.origin, journey.destination)) continue;
    const origin = endpointOf(journey, "origin");
    const destination = endpointOf(journey, "destination");
    const id = connectionId("inferred_activity", origin.id, destination.id);
    const group = groups.get(id) ?? emptyGroup(origin, destination, days);
    if (!groups.has(id)) groups.set(id, group);
    if (origin.confidence !== "inferred") group.origin = origin;
    if (destination.confidence !== "inferred") group.destination = destination;
    group.attempted += 1;
    const vessel = options.vesselKey?.(journey) ?? String(journey.device);
    group.vessels.add(vessel);
    if (!journey.credible) {
      group.excluded += 1;
      continue;
    }
    group.credibleVessels.add(vessel);
    group.durationsMs.push(journey.durationMs);
    group.distances.push(journey.straightLineM);
    const ratio = journey.straightLineM > 1 ? journey.pathM / journey.straightLineM : 1;
    group.ratios.push(ratio);
    const day = options.dayIndex?.(journey) ?? 0;
    if (day >= 0 && day < group.dayCounts.length) group.dayCounts[day] += 1;
  }

  return [...groups.entries()]
    .map(([id, group]) => {
      const passages = group.durationsMs.length;
      const medianDurationMs = quantile(group.durationsMs, 0.5);
      return {
        id,
        origin: group.origin,
        destination: group.destination,
        passages,
        vessels: group.vessels.size,
        credibleVessels: group.credibleVessels.size,
        attempted: group.attempted,
        excluded: group.excluded,
        activeDays: group.dayCounts.filter((count) => count > 0).length,
        dayCounts: group.dayCounts,
        durationsMs: group.durationsMs,
        medianDurationMs,
        iqrMs: quartileRange(group.durationsMs, CONNECTIVITY.minPassagesForIqr),
        p90Ms: group.durationsMs.length >= CONNECTIVITY.minPassagesForP90 ? quantile(group.durationsMs, 0.9) : null,
        medianDistanceM: quantile(group.distances, 0.5),
        medianPathRatio: quantile(group.ratios, 0.5),
        evidence: evidenceFor(passages, group.vessels.size),
        scope: options.scope,
        periodLabel: options.periodLabel,
        observationDays: days,
      } satisfies ConnectionIndicator;
    })
    .sort((a, b) => b.passages - a.passages || a.origin.label.localeCompare(b.origin.label) || a.destination.label.localeCompare(b.destination.label));
}

export function passagesPerObservedDay(indicator: ConnectionIndicator): number | null {
  if (indicator.observationDays <= 0 || indicator.passages <= 0) return null;
  return indicator.passages / indicator.observationDays;
}

export function durationVariability(indicator: ConnectionIndicator): number | null {
  if (indicator.medianDurationMs == null || indicator.iqrMs == null || indicator.medianDurationMs <= 0) return null;
  return indicator.iqrMs / indicator.medianDurationMs;
}

export function dayCountVariation(indicator: ConnectionIndicator): number | null {
  if (indicator.dayCounts.length < CONNECTIVITY.minDaysForConsistency) return null;
  return coefficientOfVariation(indicator.dayCounts);
}

/** Distance bands used only to compare connections of similar length. */
export function distanceBand(meters: number): number {
  if (meters < 5_000) return 0;
  if (meters < 15_000) return 1;
  if (meters < 40_000) return 2;
  return 3;
}

export const DISTANCE_BANDS = ["under 5 km", "5–15 km", "15–40 km", "40 km or more"] as const;
