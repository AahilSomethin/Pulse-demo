const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320;
const M_PER_NM = 1852;

/** Equirectangular distance in metres. Adequate for Maldives-scale estimates. */
export function distanceM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dx = (lon2 - lon1) * Math.cos(midLat) * M_PER_DEG_LNG;
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Metres from a point to a straight segment. The segment ends clamp the projection. */
export function distanceToSegmentM(
  lon: number,
  lat: number,
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const cos = Math.cos(midLat);
  const x = (value: number) => value * cos * M_PER_DEG_LNG;
  const y = (value: number) => value * M_PER_DEG_LAT;
  const px = x(lon);
  const py = y(lat);
  const ax = x(lon1);
  const ay = y(lat1);
  const bx = x(lon2);
  const by = y(lat2);
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function metersToNm(meters: number): number {
  return meters / M_PER_NM;
}

/** Minutes to cover `meters` at `speedKn`. Null when speed is not positive. */
export function etaMinutes(meters: number, speedKn: number): number | null {
  if (!(speedKn > 0) || !Number.isFinite(meters)) return null;
  return (meters / M_PER_NM / speedKn) * 60;
}

export function impliedKnots(meters: number, durationMs: number): number {
  if (!(durationMs > 0)) return Number.POSITIVE_INFINITY;
  const hours = durationMs / 3_600_000;
  return meters / M_PER_NM / hours;
}
