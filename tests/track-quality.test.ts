import { describe, expect, it } from "vitest";

import { ANOMALY } from "@/config/constants";
import { classifyTrack, countLowRateDevices, medianGapSec } from "@/lib/analytics/track-quality";
import type { VesselDataset } from "@/types/maritime";

describe("tracking quality", () => {
  it("separates fast reported movement from a contradicted jump that returns", () => {
    const fast = classifyTrack([
      { timeMs: 0, lat: 4, lon: 73, speed: 35 },
      { timeMs: 10_000, lat: 4.02, lon: 73, speed: 36 },
      { timeMs: 20_000, lat: 4.04, lon: 73, speed: 36 },
    ]);
    expect(fast).toMatchObject({ examined: 2, fastReported: 2, positionJump: 0, outAndBack: 0 });
    const spike = classifyTrack([
      { timeMs: 0, lat: 4, lon: 73, speed: 1 },
      { timeMs: 10_000, lat: 4.02, lon: 73, speed: 1 },
      { timeMs: 20_000, lat: 4, lon: 73, speed: 1 },
    ]);
    expect(spike).toMatchObject({ examined: 2, fastReported: 0, positionJump: 2, outAndBack: 1 });
    expect(spike.fastReported + spike.positionJump + spike.other).toBe(spike.examined);
  });

  it("leaves a short fast segment in the existing 40-knot count", () => {
    const jumps = classifyTrack([
      { timeMs: 0, lat: 4, lon: 73, speed: 1 },
      { timeMs: 1_000, lat: 4.0004, lon: 73, speed: 1 },
    ]);
    expect(jumps.examined).toBe(0);
  });

  it("marks a device as low rate when the typical gap is at least 15 minutes", () => {
    expect(medianGapSec([0, 20 * 60_000, 40 * 60_000])).toBe(20 * 60);
    const timeMs = Float64Array.from([0, ANOMALY.lowRateMedianSec * 1000]);
    const dataset = {
      timeMs,
      lat: Float32Array.from([4, 4.01]),
      lon: Float32Array.from([73, 73]),
      speed: Float32Array.from([1, 1]),
      tracks: [[0, 1]],
    } as VesselDataset;
    expect(countLowRateDevices(dataset)).toEqual({ devicesWithGaps: 1, lowRate: 1 });
  });
});
