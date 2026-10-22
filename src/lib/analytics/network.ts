import { median } from "@/lib/format";
import type { AreaLink, IslandLink, Journey, LandPolygon } from "@/types/maritime";

export function aggregateLinks(journeys: readonly Journey[]): IslandLink[] {
  const groups = new Map<string, { origin: string; destination: string; durations: number[]; distances: number[] }>();
  for (const journey of journeys) {
    if (!journey.credible) continue;
    const origin = journey.origin.islandName;
    const destination = journey.destination.islandName;
    if (!origin || !destination || origin === destination) continue;
    const key = `${origin}\u0000${destination}`;
    const group = groups.get(key);
    if (group) {
      group.durations.push(journey.durationMs);
      group.distances.push(journey.straightLineM);
    } else {
      groups.set(key, { origin, destination, durations: [journey.durationMs], distances: [journey.straightLineM] });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      origin: group.origin,
      destination: group.destination,
      tripCount: group.durations.length,
      medianDurationMs: median(group.durations) ?? 0,
      medianDistanceM: median(group.distances) ?? 0,
      shortestDurationMs: Math.min(...group.durations),
      longestDurationMs: Math.max(...group.durations),
      placeKind: "named_island" as const,
    }))
    .sort((a, b) => b.tripCount - a.tripCount || a.origin.localeCompare(b.origin));
}

/** Links between inferred GPS clusters. These are not island or harbour services. */
export function aggregateAreaLinks(journeys: readonly Journey[]): AreaLink[] {
  const groups = new Map<string, { link: Omit<AreaLink, "tripCount" | "medianDurationMs" | "medianDistanceM" | "shortestDurationMs" | "longestDurationMs">; durations: number[]; distances: number[] }>();
  for (const journey of journeys) {
    if (!journey.credible) continue;
    if (journey.origin.areaId === journey.destination.areaId) continue;
    const key = `${journey.origin.areaId}\u0000${journey.destination.areaId}`;
    const group = groups.get(key);
    if (group) {
      group.durations.push(journey.durationMs);
      group.distances.push(journey.straightLineM);
    } else {
      groups.set(key, {
        link: {
          originId: journey.origin.areaId,
          destinationId: journey.destination.areaId,
          origin: journey.origin.areaLabel,
          destination: journey.destination.areaLabel,
          originLat: journey.origin.areaLat,
          originLon: journey.origin.areaLon,
          destinationLat: journey.destination.areaLat,
          destinationLon: journey.destination.areaLon,
          placeKind: "inferred_activity",
        },
        durations: [journey.durationMs],
        distances: [journey.straightLineM],
      });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group.link,
      tripCount: group.durations.length,
      medianDurationMs: median(group.durations) ?? 0,
      medianDistanceM: median(group.distances) ?? 0,
      shortestDurationMs: Math.min(...group.durations),
      longestDurationMs: Math.max(...group.durations),
    }))
    .sort((a, b) => b.tripCount - a.tripCount || a.origin.localeCompare(b.origin));
}

export interface IslandConnectivity {
  name: string;
  observedLinks: number;
  tripCount: number;
}

/** Named polygons with few or no observed tracker journeys. Absence of pings is not proof of isolation. */
export function lowConnectivity(polygons: readonly LandPolygon[], links: readonly IslandLink[]): IslandConnectivity[] {
  const names = new Set<string>();
  for (const polygon of polygons) {
    if (polygon.name) names.add(polygon.name);
  }
  return [...names]
    .map((name) => {
      const related = links.filter((link) => link.origin === name || link.destination === name);
      return {
        name,
        observedLinks: related.length,
        tripCount: related.reduce((sum, link) => sum + link.tripCount, 0),
      };
    })
    .filter((item) => item.observedLinks < 2)
    .sort((a, b) => a.observedLinks - b.observedLinks || a.name.localeCompare(b.name));
}
