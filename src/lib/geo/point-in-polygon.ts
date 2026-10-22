/** Even-odd test. Ring is [lon, lat] pairs. */
export function ringContains(ring: readonly (readonly number[])[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** First ring is the shell. Later rings are holes. */
export function polygonContains(rings: readonly (readonly (readonly number[])[])[], lon: number, lat: number): boolean {
  if (rings.length === 0 || !ringContains(rings[0], lon, lat)) return false;
  for (let i = 1; i < rings.length; i++) {
    if (ringContains(rings[i], lon, lat)) return false;
  }
  return true;
}

export function locateIsland(
  polygons: readonly { id: string; name: string | null; rings: number[][][] }[],
  lon: number,
  lat: number,
): { id: string; name: string | null } | null {
  for (const polygon of polygons) {
    if (polygonContains(polygon.rings, lon, lat)) return { id: polygon.id, name: polygon.name };
  }
  return null;
}
