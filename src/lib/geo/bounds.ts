export interface LngLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function extendBounds(bounds: LngLatBounds | null, lon: number, lat: number): LngLatBounds {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return bounds ?? { west: 0, south: 0, east: 0, north: 0 };
  if (!bounds) return { west: lon, south: lat, east: lon, north: lat };
  return {
    west: Math.min(bounds.west, lon),
    south: Math.min(bounds.south, lat),
    east: Math.max(bounds.east, lon),
    north: Math.max(bounds.north, lat),
  };
}

export function ringBounds(rings: readonly (readonly (readonly number[])[])[]): LngLatBounds | null {
  let bounds: LngLatBounds | null = null;
  for (const ring of rings) {
    for (const pair of ring) {
      if (pair.length < 2) continue;
      bounds = extendBounds(bounds, pair[0], pair[1]);
    }
  }
  return bounds;
}

export function unionBounds(items: readonly (LngLatBounds | null)[]): LngLatBounds | null {
  let bounds: LngLatBounds | null = null;
  for (const item of items) {
    if (!item) continue;
    bounds = extendBounds(bounds, item.west, item.south);
    bounds = extendBounds(bounds, item.east, item.north);
  }
  return bounds;
}

export function boundsCenter(bounds: LngLatBounds): { lon: number; lat: number } {
  return { lon: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 };
}
