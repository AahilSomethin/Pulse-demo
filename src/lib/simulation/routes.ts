import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import { etaMinutes } from "@/lib/geo/distance";
import type { AreaLink, IslandLink } from "@/types/maritime";

export interface ObservedRouteComparison {
  origin: string;
  destination: string;
  placeKind: "named_island" | "inferred_activity";
  observedTrips: number;
  observedMedianMin: number | null;
  observedShortestMin: number | null;
  observedLongestMin: number | null;
  observedMedianM: number | null;
  reportedMovingKn: number | null;
  straightLineMin: number | null;
  extraMin: number | null;
}

type ObservedLink = IslandLink | AreaLink;

export interface ConnectionComparison {
  origin: string;
  destination: string;
  observedTrips: number;
  observedMedianMin: number | null;
  observedMedianM: number | null;
  proposedMin: number;
  differenceMin: number | null;
}

export function findLink(links: readonly IslandLink[], origin: string, destination: string): IslandLink | null {
  return links.find((link) => link.origin === origin && link.destination === destination) ?? null;
}

/**
 * Observed dwell-to-dwell time against the straight-line time at the file's
 * median reported moving speed. The speed unit is unverified. Neither figure
 * is a timetable.
 */
export function describeObservation(link: ObservedLink | null, reportedMovingKn: number | null): ObservedRouteComparison {
  const observedMedianMin = link && link.tripCount > 0 ? link.medianDurationMs / 60_000 : null;
  const straightLineMin = link && reportedMovingKn != null ? etaMinutes(link.medianDistanceM, reportedMovingKn) : null;
  return {
    origin: link?.origin ?? "",
    destination: link?.destination ?? "",
    placeKind: link?.placeKind ?? "inferred_activity",
    observedTrips: link?.tripCount ?? 0,
    observedMedianMin,
    observedShortestMin: link && link.tripCount > 0 ? link.shortestDurationMs / 60_000 : null,
    observedLongestMin: link && link.tripCount > 0 ? link.longestDurationMs / 60_000 : null,
    observedMedianM: link && link.tripCount > 0 ? link.medianDistanceM : null,
    reportedMovingKn,
    straightLineMin,
    extraMin: observedMedianMin == null || straightLineMin == null ? null : observedMedianMin - straightLineMin,
  };
}

/** Compares an observed median with a user-entered direct time. The proposal is not a timetable. */
export function simulateConnection(link: IslandLink | null, origin: string, destination: string, proposedMin: number): ConnectionComparison {
  const observedMedianMin = link ? link.medianDurationMs / 60_000 : null;
  return {
    origin,
    destination,
    observedTrips: link?.tripCount ?? 0,
    observedMedianMin,
    observedMedianM: link?.medianDistanceM ?? null,
    proposedMin,
    differenceMin: observedMedianMin == null ? null : observedMedianMin - proposedMin,
  };
}

export interface DurationBin {
  label: string;
  count: number;
}

export interface RouteBaseline {
  journeys: number;
  vessels: number;
  medianMin: number | null;
  iqrMin: number | null;
  p90Min: number | null;
  straightLineKm: number | null;
  pathRatio: number | null;
  excluded: number;
  evidence: ConnectionIndicator["evidence"] | null;
  histogram: DurationBin[];
  periodLabel: string;
  observationDays: number;
}

export interface ScenarioComparison {
  proposedMin: number;
  versusMedianMin: number | null;
  versusP90Min: number | null;
  assumptions: string[];
  evidenceNeeded: string[];
}

const BIN_MINUTES = 15;

/** Fifteen-minute bins from the pooled durations. The last bin collects the tail. */
export function durationHistogram(durationsMs: readonly number[], bins = 8): DurationBin[] {
  const counts = Array.from({ length: bins }, () => 0);
  let tail = 0;
  for (const duration of durationsMs) {
    const minutes = duration / 60_000;
    const index = Math.floor(minutes / BIN_MINUTES);
    if (index >= bins) tail += 1;
    else if (index >= 0) counts[index] += 1;
  }
  const rows = counts.map((count, index) => ({
    label: `${index * BIN_MINUTES}–${(index + 1) * BIN_MINUTES} min`,
    count,
  }));
  if (tail > 0) rows.push({ label: `${bins * BIN_MINUTES} min or more`, count: tail });
  return rows;
}

export function describeBaseline(indicator: ConnectionIndicator | null): RouteBaseline {
  return {
    journeys: indicator?.passages ?? 0,
    vessels: indicator?.vessels ?? 0,
    medianMin: indicator?.medianDurationMs == null ? null : indicator.medianDurationMs / 60_000,
    iqrMin: indicator?.iqrMs == null ? null : indicator.iqrMs / 60_000,
    p90Min: indicator?.p90Ms == null ? null : indicator.p90Ms / 60_000,
    straightLineKm: indicator?.medianDistanceM == null ? null : indicator.medianDistanceM / 1000,
    pathRatio: indicator?.medianPathRatio ?? null,
    excluded: indicator?.excluded ?? 0,
    evidence: indicator?.evidence ?? null,
    histogram: durationHistogram(indicator?.durationsMs ?? []),
    periodLabel: indicator?.periodLabel ?? "",
    observationDays: indicator?.observationDays ?? 0,
  };
}

export function compareScenario(baseline: RouteBaseline, proposedMin: number): ScenarioComparison {
  return {
    proposedMin,
    versusMedianMin: baseline.medianMin == null ? null : baseline.medianMin - proposedMin,
    versusP90Min: baseline.p90Min == null ? null : baseline.p90Min - proposedMin,
    assumptions: [
      "The typed duration is a hypothetical direct time. It is not taken from the tracker file.",
      "The comparison does not change the observed journeys.",
    ],
    evidenceNeeded: [
      "A navigable path, not the straight line between the two clusters.",
      "The vessel types that actually make this passage, and a verified speed for them.",
      "How much of the observed time is waiting, cargo, or a gap in tracking.",
      "A schedule, demand, and fleet only if a later study collects them. This file does not contain them.",
    ],
  };
}
