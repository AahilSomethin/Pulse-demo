import { PLAYBACK_TICK_MS } from "@/config/constants";

/** Wall-clock multipliers. 1× matches the original sixth-of-a-window step every 90 ms. */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const PLAYBACK_SPEED_LABEL: Record<PlaybackSpeed, string> = {
  0.25: "Slow",
  0.5: "Reduced",
  1: "Normal",
  2: "Fast",
  4: "Very fast",
  8: "Presentation speed",
};

export function isPlaybackSpeed(value: number): value is PlaybackSpeed {
  return (PLAYBACK_SPEEDS as readonly number[]).includes(value);
}

/**
 * Timeline milliseconds to add for a stretch of wall-clock time.
 * This is one sample step. It does not list the GPS reports inside the step.
 */
export function playbackStep(windowMs: number, speed: number, elapsedMs: number): number {
  if (!(windowMs > 0) || !(speed > 0) || !(elapsedMs > 0)) return 0;
  if (!Number.isFinite(windowMs) || !Number.isFinite(speed) || !Number.isFinite(elapsedMs)) return 0;
  return (windowMs / 6) * speed * (elapsedMs / PLAYBACK_TICK_MS);
}

/** How often the clock commits. 1× stays on the original 90 ms tick; 8× stays near a frame. */
export function commitIntervalMs(speed: number): number {
  const safe = speed > 0 && Number.isFinite(speed) ? speed : 1;
  return Math.min(90, Math.max(33, 90 / safe));
}

export interface PlaybackAdvance {
  cursor: number;
  /** Timeline still to apply after the end of the day has been shown. */
  remainder: number;
}

/**
 * Moves the cursor once.
 * A step that passes the end of the day stops on that timestamp and returns the
 * unused remainder, so the next call can wrap. A large remainder wraps with
 * modulo and still returns a single cursor inside the day.
 */
export function advancePlayback(cursor: number, t0: number, t1: number, step: number): PlaybackAdvance {
  if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) {
    return { cursor: Number.isFinite(cursor) ? cursor : 0, remainder: 0 };
  }
  const current = Number.isFinite(cursor) ? Math.min(Math.max(cursor, t0), t1) : t0;
  if (!(step > 0) || !Number.isFinite(step)) return { cursor: current, remainder: 0 };
  const span = t1 - t0;
  if (current < t1) {
    const room = t1 - current;
    if (step < room) return { cursor: current + step, remainder: 0 };
    if (step === room) return { cursor: t1, remainder: 0 };
    return { cursor: t1, remainder: step - room };
  }
  const into = step % span;
  if (into === 0) return { cursor: t1, remainder: 0 };
  return { cursor: t0 + into, remainder: 0 };
}
