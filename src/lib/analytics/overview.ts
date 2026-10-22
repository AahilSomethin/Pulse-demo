import { STOP_SPEED_KN } from "@/config/constants";
import type { VesselDataset } from "@/types/maritime";

export interface OverviewStats {
  pings: number;
  devices: number;
  t0: number;
  t1: number;
  spanMs: number;
  bounds: VesselDataset["bounds"];
  slowPings: number;
  movingPings: number;
  devicesWithMotion: number;
  rejected: VesselDataset["rejected"];
}

export function summarize(dataset: VesselDataset): OverviewStats {
  let slowPings = 0;
  const moved = new Uint8Array(dataset.names.length);
  for (let i = 0; i < dataset.speed.length; i++) {
    if (dataset.speed[i] < STOP_SPEED_KN) slowPings += 1;
    else moved[dataset.deviceIndex[i]] = 1;
  }
  let devicesWithMotion = 0;
  for (const flag of moved) devicesWithMotion += flag;
  return {
    pings: dataset.kept,
    devices: dataset.names.length,
    t0: dataset.t0,
    t1: dataset.t1,
    spanMs: dataset.t1 - dataset.t0,
    bounds: dataset.bounds,
    slowPings,
    movingPings: dataset.kept - slowPings,
    devicesWithMotion,
    rejected: dataset.rejected,
  };
}
