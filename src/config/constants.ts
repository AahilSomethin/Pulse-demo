/** Exclusive Maldives box used by the original viewer. Edges are rejected. */
export const MALDIVES_BOX = {
  minLat: -0.8,
  maxLat: 7.2,
  minLon: 72.5,
  maxLon: 73.9,
} as const;

/** Instantaneous stop threshold from the original hub mode. Not a dwell. */
export const STOP_SPEED_KN = 0.5;

export const WINDOW_OPTIONS = [
  { label: "5 min", ms: 300_000 },
  { label: "15 min", ms: 900_000 },
  { label: "1 hour", ms: 3_600_000 },
  { label: "6 hours", ms: 21_600_000 },
] as const;

export const DEFAULT_WINDOW_MS = 900_000;
export const DEFAULT_CELL_DEG = 0.02;

export const CELL_OPTIONS = [
  { label: "≈1 km", deg: 0.01 },
  { label: "≈2 km", deg: 0.02 },
  { label: "≈5 km", deg: 0.05 },
] as const;

export const PLAYBACK_TICK_MS = 90;

/** Inferred dwell, separate from the original instantaneous hub rule. */
export const DWELL_MIN_MS = 10 * 60 * 1000;
export const DWELL_RADIUS_M = 400;
export const DWELL_MAX_GAP_MS = 20 * 60 * 1000;

/** Straight-line speed above this is treated as a tracker gap, not a passage. */
export const IMPLAUSIBLE_KN = 40;

/** Grid for inferred activity areas. A cell is not a harbour. */
export const AREA_CELL_DEG = 0.05;

export const DEFAULT_VESSEL_RESPONSE_KN = 12;
export const DEFAULT_COAST_GUARD_KN = 25;
export const DEFAULT_RESPONSE_RADIUS_M = 20_000;

export const MVT_OFFSET_MS = 5 * 60 * 60 * 1000;

export const MAP_CENTER = { longitude: 73.5, latitude: 4.2, zoom: 6 } as const;
