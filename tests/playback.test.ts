import { describe, expect, it } from "vitest";

import { PLAYBACK_TICK_MS } from "@/config/constants";
import { advancePlayback, commitIntervalMs, playbackStep, PLAYBACK_SPEEDS } from "@/lib/vessels/playback";

describe("playback speed", () => {
  it("keeps 1× on the original sixth-of-a-window step", () => {
    expect(playbackStep(900_000, 1, PLAYBACK_TICK_MS)).toBe(900_000 / 6);
    expect(playbackStep(300_000, 1, PLAYBACK_TICK_MS)).toBe(50_000);
  });

  it("scales the clock and not a list of GPS samples", () => {
    const normal = playbackStep(300_000, 1, PLAYBACK_TICK_MS);
    expect(playbackStep(300_000, 8, PLAYBACK_TICK_MS)).toBe(normal * 8);
    expect(playbackStep(300_000, 0.25, PLAYBACK_TICK_MS)).toBe(normal * 0.25);
    for (const speed of PLAYBACK_SPEEDS) {
      const step = playbackStep(900_000, speed, 1_000);
      expect(Number.isFinite(step)).toBe(true);
      expect(step).toBeGreaterThan(0);
    }
  });

  it("commits fast speeds often enough to stay responsive and slow speeds on the original tick", () => {
    expect(commitIntervalMs(1)).toBe(90);
    expect(commitIntervalMs(0.25)).toBe(90);
    expect(commitIntervalMs(8)).toBeGreaterThanOrEqual(33);
    expect(commitIntervalMs(8)).toBeLessThanOrEqual(90);
  });

  it("parks on the end of the day once, then wraps a large jump to one cursor", () => {
    const t0 = 0;
    const t1 = 86_400_000;
    const huge = playbackStep(900_000, 8, 60_000);
    const parked = advancePlayback(t0, t0, t1, huge);
    expect(parked.cursor).toBe(t1);
    expect(parked.remainder).toBeGreaterThan(t1);
    expect(Object.keys(parked).sort()).toEqual(["cursor", "remainder"]);

    const wrapped = advancePlayback(parked.cursor, t0, t1, parked.remainder);
    expect(wrapped.remainder).toBe(0);
    expect(wrapped.cursor).toBeGreaterThanOrEqual(t0);
    expect(wrapped.cursor).toBeLessThanOrEqual(t1);
    expect(wrapped.cursor).not.toBe(t1);
  });

  it("rejects empty or invalid steps without moving the cursor", () => {
    expect(advancePlayback(50, 0, 100, 0)).toEqual({ cursor: 50, remainder: 0 });
    expect(advancePlayback(Number.NaN, 0, 100, 10)).toEqual({ cursor: 10, remainder: 0 });
    expect(playbackStep(900_000, 8, 0)).toBe(0);
    expect(playbackStep(Number.POSITIVE_INFINITY, 8, 90)).toBe(0);
  });
});
