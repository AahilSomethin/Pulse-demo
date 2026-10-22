import { boundsCenter, ringBounds } from "@/lib/geo/bounds";
import { maskDevice } from "@/lib/format";
import { ATOLL_CODES, ATOLL_TITLES, atollQueryText, normalisePlaceName, type AtollCode } from "@/lib/reference/atolls";
import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import type { HarbourPoint, LandPolygon } from "@/types/maritime";

export type SearchKind = "island" | "atoll" | "harbour" | "vessel" | "area";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  ambiguous: boolean;
  lon: number | null;
  lat: number | null;
  device: number | null;
  atoll: string | null;
}

export interface SearchGroup {
  id: SearchKind;
  label: string;
  hits: SearchHit[];
}

export interface SearchResults {
  groups: SearchGroup[];
  notes: string[];
}

export interface SearchInput {
  polygons: readonly LandPolygon[];
  harbours: readonly HarbourPoint[];
  indicators: readonly ConnectionIndicator[];
  vesselNames: readonly string[] | null;
  polygonCountByAtoll: ReadonlyMap<string, number>;
}

const GROUP_LABEL: Record<SearchKind, string> = {
  island: "Islands",
  atoll: "Atolls",
  harbour: "Harbour reference",
  vessel: "Tracked vessels",
  area: "Inferred activity areas",
};

function includes(query: string, value: string | null | undefined): boolean {
  if (!value) return false;
  if (value.toLowerCase().includes(query)) return true;
  const normalisedQuery = normalisePlaceName(query);
  const normalisedValue = normalisePlaceName(value);
  return normalisedQuery.length > 0 && normalisedValue.includes(normalisedQuery);
}

function islandKey(polygon: LandPolygon): string {
  if (!polygon.name) return polygon.id;
  return normalisePlaceName(polygon.name) || polygon.name.trim();
}

export function searchPlaces(rawQuery: string, input: SearchInput): SearchResults {
  const query = rawQuery.trim().toLowerCase();
  const notes: string[] = [];
  if (query.length < 2) return { groups: [], notes };
  const nameCounts = new Map<string, number>();
  for (const polygon of input.polygons) {
    if (!polygon.name || polygon.synthetic) continue;
    const key = islandKey(polygon);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const islands: SearchHit[] = [];
  for (const polygon of input.polygons) {
    if (polygon.synthetic || islands.length >= 8) continue;
    if (!includes(query, polygon.name) && !includes(query, polygon.nameDv) && !includes(query, polygon.atoll)) continue;
    const bounds = ringBounds(polygon.rings);
    const center = bounds ? boundsCenter(bounds) : null;
    const shared = polygon.name ? (nameCounts.get(islandKey(polygon)) ?? 0) > 1 : false;
    const atoll = polygon.atoll ? `${ATOLL_TITLES[polygon.atoll as AtollCode] ?? polygon.atoll} (${polygon.atoll})` : "Atoll unknown";
    const dhivehi = polygon.nameDv && polygon.nameDv !== polygon.name ? polygon.nameDv : null;
    islands.push({
      kind: "island",
      id: polygon.id,
      title: polygon.name ?? "Unnamed island",
      subtitle: [atoll, dhivehi, shared ? "Shared name — choose this row. It is not selected automatically." : null, "OpenStreetMap reference. Not a complete official list."]
        .filter(Boolean)
        .join(" · "),
      ambiguous: shared,
      lon: center?.lon ?? null,
      lat: center?.lat ?? null,
      device: null,
      atoll: polygon.atoll,
    });
  }

  const atolls: SearchHit[] = [];
  for (const code of ATOLL_CODES) {
    if (atolls.length >= 8) break;
    if (!includes(query, atollQueryText(code)) && !includes(query, code)) continue;
    const count = input.polygonCountByAtoll.get(code) ?? 0;
    atolls.push({
      kind: "atoll",
      id: code,
      title: `${ATOLL_TITLES[code]} (${code})`,
      subtitle: count > 0
        ? `${count} named island ${count === 1 ? "polygon" : "polygons"} in the reference file`
        : "No island polygons in this reference file carry this code. Seven atolls have no boundary geometry.",
      ambiguous: false,
      lon: null,
      lat: null,
      device: null,
      atoll: code,
    });
  }

  const harbours: SearchHit[] = [];
  if (input.harbours.length === 0) notes.push("Harbour locations are not loaded.");
  for (const harbour of input.harbours) {
    if (harbours.length >= 8) break;
    if (!includes(query, harbour.name)) continue;
    harbours.push({
      kind: "harbour",
      id: harbour.id,
      title: harbour.name ?? "Unnamed harbour point",
      subtitle: "OpenStreetMap harbour, pier, or ferry terminal. Not a verified port call.",
      ambiguous: false,
      lon: harbour.lon,
      lat: harbour.lat,
      device: null,
      atoll: null,
    });
  }

  const vessels: SearchHit[] = [];
  if (!input.vesselNames) {
    if (query.length >= 4) notes.push("Load a tracker day to search vessels. The full device list is not published.");
  } else if (query.length < 4) {
    for (let device = 0; device < input.vesselNames.length && vessels.length < 8; device += 1) {
      const name = input.vesselNames[device];
      if (name.toLowerCase() !== query) continue;
      vessels.push({
        kind: "vessel",
        id: String(device),
        title: maskDevice(name),
        subtitle: "Loaded day · historical track. The full identifier stays hidden.",
        ambiguous: false,
        lon: null,
        lat: null,
        device,
        atoll: null,
      });
    }
    if (vessels.length === 0) notes.push("Type at least 4 characters to search a vessel in the loaded day. A shorter query matches only a complete identifier.");
  } else {
    for (let device = 0; device < input.vesselNames.length && vessels.length < 8; device += 1) {
      const name = input.vesselNames[device];
      if (!name.toLowerCase().includes(query)) continue;
      vessels.push({
        kind: "vessel",
        id: String(device),
        title: maskDevice(name),
        subtitle: "Loaded day · historical track. The full identifier stays hidden.",
        ambiguous: false,
        lon: null,
        lat: null,
        device,
        atoll: null,
      });
    }
  }

  const areas: SearchHit[] = [];
  const seen = new Set<string>();
  for (const indicator of input.indicators) {
    for (const end of [indicator.origin, indicator.destination]) {
      if (areas.length >= 8 || end.confidence !== "inferred" || seen.has(end.id)) continue;
      seen.add(end.id);
      if (!includes(query, end.label)) continue;
      areas.push({
        kind: "area",
        id: end.id,
        title: end.label,
        subtitle: "Inferred activity area. Not an island, harbour, or terminal.",
        ambiguous: false,
        lon: end.lon,
        lat: end.lat,
        device: null,
        atoll: end.atoll,
      });
    }
  }

  const groups = (["island", "atoll", "harbour", "vessel", "area"] as const)
    .map((id) => ({
      id,
      label: GROUP_LABEL[id],
      hits: id === "island" ? islands : id === "atoll" ? atolls : id === "harbour" ? harbours : id === "vessel" ? vessels : areas,
    }))
    .filter((group) => group.hits.length > 0);
  if (groups.length === 0) notes.unshift("No island, atoll, harbour, vessel, or inferred area matches.");
  return { groups, notes };
}
