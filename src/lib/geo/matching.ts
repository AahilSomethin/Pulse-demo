import { CONNECTIVITY } from "@/config/constants";
import { distanceM } from "@/lib/geo/distance";
import { createPolygonIndex } from "@/lib/geo/spatial-index";
import type { GeoConfidence, HarbourPoint, LandPolygon } from "@/types/maritime";

export interface PlaceMatch {
  confidence: GeoConfidence;
  islandId: string | null;
  islandName: string | null;
  harbourId: string | null;
  harbourName: string | null;
  atoll: string | null;
}

export interface PlaceLocator {
  locate(lat: number, lon: number): PlaceMatch;
}

const NONE: PlaceMatch = {
  confidence: "inferred",
  islandId: null,
  islandName: null,
  harbourId: null,
  harbourName: null,
  atoll: null,
};

const HARBOUR_CELL = 0.02;

function harbourKey(lon: number, lat: number): string {
  return `${Math.floor(lon / HARBOUR_CELL)}:${Math.floor(lat / HARBOUR_CELL)}`;
}

function nearestHarbour(harbours: ReadonlyMap<string, HarbourPoint[]>, lat: number, lon: number): HarbourPoint | null {
  const x = Math.floor(lon / HARBOUR_CELL);
  const y = Math.floor(lat / HARBOUR_CELL);
  let nearest: HarbourPoint | null = null;
  let nearestM: number = CONNECTIVITY.harbourMatchM;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const list = harbours.get(`${x + dx}:${y + dy}`);
      if (!list) continue;
      for (const harbour of list) {
        const meters = distanceM(lon, lat, harbour.lon, harbour.lat);
        if (meters <= nearestM) {
          nearest = harbour;
          nearestM = meters;
        }
      }
    }
  }
  return nearest;
}

/** Named polygon wins. A harbour within the match radius is next. Otherwise the stop stays inferred. */
export function createPlaceLocator(polygons: readonly LandPolygon[], harbours: readonly HarbourPoint[]): PlaceLocator {
  const index = createPolygonIndex(polygons);
  const atollById = new Map(polygons.map((polygon) => [polygon.id, polygon.atoll]));
  const harbourGrid = new Map<string, HarbourPoint[]>();
  for (const harbour of harbours) {
    const key = harbourKey(harbour.lon, harbour.lat);
    const list = harbourGrid.get(key);
    if (list) list.push(harbour);
    else harbourGrid.set(key, [harbour]);
  }
  return {
    locate(lat: number, lon: number): PlaceMatch {
      const island = index.locate(lon, lat);
      if (island?.name) {
        return {
          confidence: "named_polygon",
          islandId: island.id,
          islandName: island.name,
          harbourId: null,
          harbourName: null,
          atoll: atollById.get(island.id) ?? null,
        };
      }
      const nearest = nearestHarbour(harbourGrid, lat, lon);
      if (nearest) {
        return {
          confidence: "near_harbour",
          islandId: island?.id ?? null,
          islandName: null,
          harbourId: nearest.id,
          harbourName: nearest.name,
          atoll: null,
        };
      }
      return island ? { ...NONE, islandId: island.id } : NONE;
    },
  };
}
