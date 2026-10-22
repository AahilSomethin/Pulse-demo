import { normalisePlaceName } from "@/lib/reference/atolls";
import type { ConnectionEndpoint } from "@/lib/analytics/connectivity";
import type { Dwell, GeoConfidence, Journey } from "@/types/maritime";

export interface IslandEnd {
  confidence: GeoConfidence;
  sourceId: string | null;
  islandName: string | null;
  atoll: string | null;
}

function sameName(left: string, right: string): boolean {
  if (left.trim() === right.trim()) return true;
  const a = normalisePlaceName(left);
  const b = normalisePlaceName(right);
  return a.length > 0 && a === b;
}

/**
 * Two named-polygon ends are the same verified island when they share a polygon id,
 * or the same island name without conflicting atolls. A repeated name in two atolls stays a crossing.
 */
export function sameNamedIsland(origin: IslandEnd, destination: IslandEnd): boolean {
  if (origin.confidence !== "named_polygon" || destination.confidence !== "named_polygon") return false;
  if (origin.sourceId && destination.sourceId && origin.sourceId === destination.sourceId) return true;
  if (!origin.islandName || !destination.islandName) return false;
  if (!sameName(origin.islandName, destination.islandName)) return false;
  if (origin.atoll && destination.atoll && origin.atoll !== destination.atoll) return false;
  return true;
}

export function dwellsSameIsland(origin: Dwell, destination: Dwell): boolean {
  return sameNamedIsland(
    { confidence: origin.confidence, sourceId: origin.islandId, islandName: origin.islandName, atoll: origin.atoll },
    { confidence: destination.confidence, sourceId: destination.islandId, islandName: destination.islandName, atoll: destination.atoll },
  );
}

/** Island name stored ahead of the activity-cell label, as `Name · cell`. */
export function islandNameFromLabel(label: string, confidence: GeoConfidence): string | null {
  if (confidence !== "named_polygon") return null;
  const index = label.indexOf(" · ");
  if (index <= 0) return null;
  return label.slice(0, index);
}

export function endpointsSameIsland(origin: ConnectionEndpoint, destination: ConnectionEndpoint): boolean {
  return sameNamedIsland(
    {
      confidence: origin.confidence,
      sourceId: origin.sourceId,
      islandName: islandNameFromLabel(origin.label, origin.confidence),
      atoll: origin.atoll,
    },
    {
      confidence: destination.confidence,
      sourceId: destination.sourceId,
      islandName: islandNameFromLabel(destination.label, destination.confidence),
      atoll: destination.atoll,
    },
  );
}

/** Passages between different cells on one named island. Same-cell stays are not included. */
export function countSameIslandJourneys(journeys: readonly Journey[]): number {
  let count = 0;
  for (const journey of journeys) {
    if (journey.origin.areaId === journey.destination.areaId) continue;
    if (dwellsSameIsland(journey.origin, journey.destination)) count += 1;
  }
  return count;
}
