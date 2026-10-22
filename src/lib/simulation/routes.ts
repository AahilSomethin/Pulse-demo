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
