import { STOP_SPEED_KN } from "@/config/constants";
import type { ActivityFrame, HubCell, HubMode, VesselDataset, VesselPosition } from "@/types/maritime";

export function lowerBound(times: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Same initial frame as the original 0–1000 slider, without integer snapping.
 * The slider stalled once the step fell below 1, which happens on files longer
 * than about two days at a 15-minute window.
 */
export function initialCursor(t0: number, t1: number, windowMs: number): number {
  const span = t1 - t0 || 1;
  const slider = Math.min(1000, (1000 * windowMs) / span);
  return t0 + (span * slider) / 1000;
}

/** Advances by one sixth of the window, then wraps to the start. Matches the original tick. */
export function advanceCursor(cursor: number, t0: number, t1: number, windowMs: number): number {
  const next = cursor + windowMs / 6;
  return next > t1 ? t0 : next;
}

/**
 * Original "min peak speed": at least three pings in the whole file at or above
 * the threshold. Zero disables the filter.
 */
export function buildSpeedMask(dataset: VesselDataset, threshold: number): Uint8Array {
  const mask = new Uint8Array(dataset.names.length);
  if (!threshold) {
    mask.fill(1);
    return mask;
  }
  const counts = new Int32Array(dataset.names.length);
  for (let i = 0; i < dataset.speed.length; i++) {
    if (dataset.speed[i] >= threshold) counts[dataset.deviceIndex[i]] += 1;
  }
  for (let device = 0; device < mask.length; device++) mask[device] = counts[device] >= 3 ? 1 : 0;
  return mask;
}

export function computeFrame(
  dataset: VesselDataset,
  cursorMs: number,
  windowMs: number,
  cellDeg: number,
  mode: HubMode,
  mask: Uint8Array,
  selected: number,
): ActivityFrame {
  const start = lowerBound(dataset.timeMs, cursorMs - windowMs);
  const end = lowerBound(dataset.timeMs, cursorMs + 1);
  const lastIndex = new Int32Array(dataset.names.length);
  lastIndex.fill(-1);
  const cells = new Map<number, { fx: number; fy: number; devices: Set<number> }>();
  let pingCount = 0;

  for (let index = start; index < end; index++) {
    const device = dataset.deviceIndex[index];
    if (device !== selected && !mask[device]) continue;
    pingCount += 1;
    lastIndex[device] = index;
    const stopped = dataset.speed[index] < STOP_SPEED_KN;
    if ((mode === "stop" && !stopped) || (mode === "move" && stopped)) continue;
    const fx = Math.floor(dataset.lon[index] / cellDeg);
    const fy = Math.floor(dataset.lat[index] / cellDeg);
    const key = fy * 10000 + fx;
    let cell = cells.get(key);
    if (!cell) {
      cell = { fx, fy, devices: new Set() };
      cells.set(key, cell);
    }
    cell.devices.add(device);
  }

  let maxDevices = 1;
  for (const cell of cells.values()) maxDevices = Math.max(maxDevices, cell.devices.size);
  const hubs: HubCell[] = [];
  for (const cell of cells.values()) {
    hubs.push({
      fx: cell.fx,
      fy: cell.fy,
      devices: cell.devices.size,
      centerLat: (cell.fy + 0.5) * cellDeg,
      centerLon: (cell.fx + 0.5) * cellDeg,
      alpha: 0.2 + (0.8 * cell.devices.size) / maxDevices,
    });
  }
  const topHubs = hubs.slice().sort((a, b) => b.devices - a.devices).slice(0, 5);
  const positions: VesselPosition[] = [];
  for (let device = 0; device < lastIndex.length; device++) {
    if (lastIndex[device] >= 0) positions.push({ device, index: lastIndex[device] });
  }
  return { cursorMs, windowMs, pingCount, positions, hubs, topHubs };
}

/** Bold trail rule from the original viewer: (t - W, t]. */
export function trailIndexes(dataset: VesselDataset, device: number, cursorMs: number, windowMs: number): number[] {
  const indexes = dataset.tracks[device] ?? [];
  return indexes.filter((index) => dataset.timeMs[index] > cursorMs - windowMs && dataset.timeMs[index] <= cursorMs);
}
