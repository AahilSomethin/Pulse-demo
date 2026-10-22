import type { MapTheme } from "@/config/map-colors";

/** Soft fill band. The hard cap stays at 25% even if the span is tuned. */
export const HUB_FILL_MIN = 0.03;
export const HUB_FILL_SPAN = 0.19;
export const HUB_FILL_CAP = 0.25;

/**
 * Share of the busiest cell in this frame. The frame still stores the original
 * linear alpha; this ratio is only for paint.
 */
export function hubIntensity(devices: number, maxDevices: number): number {
  if (maxDevices <= 0 || devices <= 0) return 0;
  return Math.min(1, devices / maxDevices);
}

/**
 * Gentler than a square root. On the August day a square root lifted 1-vessel
 * cells close to the Malé peak, so the grid read as one wash. 0.8 still
 * compresses the outlier and leaves the 3–22% band intact.
 */
export const HUB_CURVE = 0.8;

export function hubCurve(devices: number, maxDevices: number): number {
  return Math.pow(hubIntensity(devices, maxDevices), HUB_CURVE);
}

export function hubFillOpacity(devices: number, maxDevices: number): number {
  const opacity = HUB_FILL_MIN + HUB_FILL_SPAN * hubCurve(devices, maxDevices);
  return Math.min(HUB_FILL_CAP, opacity);
}

/** Thin stroke. Light maps use the upper part of the 25–50% band so the line holds. */
export function hubLineOpacity(devices: number, maxDevices: number, theme: MapTheme): number {
  const curved = hubCurve(devices, maxDevices);
  if (theme === "light") return 0.36 + 0.14 * curved;
  return 0.25 + 0.25 * curved;
}
