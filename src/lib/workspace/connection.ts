import { connectionId, type PlaceKind } from "@/lib/workspace/state";
import type { AreaLink, IslandLink, Journey } from "@/types/maritime";

type AnyLink = IslandLink | AreaLink;

export function linkKey(link: AnyLink): string {
  if (link.placeKind === "inferred_activity") return connectionId("inferred_activity", link.originId, link.destinationId);
  return connectionId("named_island", link.origin, link.destination);
}

export function findLink(links: readonly AnyLink[], id: string): AnyLink | null {
  return links.find((link) => linkKey(link) === id) ?? null;
}

export function coverageGapsFor(journeys: readonly Journey[], link: AnyLink): number {
  return journeys.filter((journey) => {
    if (!journey.coverageGap) return false;
    if (link.placeKind === "named_island") {
      return journey.origin.islandName === link.origin && journey.destination.islandName === link.destination;
    }
    return journey.origin.areaId === link.originId && journey.destination.areaId === link.destinationId;
  }).length;
}

export function placeKindLabel(kind: PlaceKind): string {
  return kind === "named_island" ? "Named polygon" : "Inferred cluster";
}
