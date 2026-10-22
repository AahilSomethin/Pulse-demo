import { polygonContains } from "@/lib/geo/point-in-polygon";

interface IndexedPolygon {
  id: string;
  name: string | null;
  rings: number[][][];
  order: number;
}

const CELL = 0.1;

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function bbox(rings: number[][][]): { minLon: number; maxLon: number; minLat: number; maxLat: number } | null {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const pair of ring) {
      if (pair.length < 2) continue;
      minLon = Math.min(minLon, pair[0]);
      maxLon = Math.max(maxLon, pair[0]);
      minLat = Math.min(minLat, pair[1]);
      maxLat = Math.max(maxLat, pair[1]);
    }
  }
  if (!Number.isFinite(minLon)) return null;
  return { minLon, maxLon, minLat, maxLat };
}

/** Bounding-box grid. Candidates are tested in source order, so the hit matches a linear scan. */
export function createPolygonIndex(polygons: readonly { id: string; name: string | null; rings: number[][][] }[]) {
  const buckets = new Map<string, IndexedPolygon[]>();
  polygons.forEach((polygon, order) => {
    const box = bbox(polygon.rings);
    if (!box) return;
    const item: IndexedPolygon = { id: polygon.id, name: polygon.name, rings: polygon.rings, order };
    const x0 = Math.floor(box.minLon / CELL);
    const x1 = Math.floor(box.maxLon / CELL);
    const y0 = Math.floor(box.minLat / CELL);
    const y1 = Math.floor(box.maxLat / CELL);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const key = cellKey(x, y);
        const list = buckets.get(key);
        if (list) list.push(item);
        else buckets.set(key, [item]);
      }
    }
  });

  return {
    locate(lon: number, lat: number): { id: string; name: string | null } | null {
      const list = buckets.get(cellKey(Math.floor(lon / CELL), Math.floor(lat / CELL)));
      if (!list) return null;
      let best: IndexedPolygon | null = null;
      for (const item of list) {
        if (best && item.order >= best.order) continue;
        if (polygonContains(item.rings, lon, lat)) best = item;
      }
      return best ? { id: best.id, name: best.name } : null;
    },
  };
}
