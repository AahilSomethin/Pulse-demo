import { EMPTY_OVERLAY, type MapOverlay } from "@/types/map";

let current = EMPTY_OVERLAY;
let generation = 0;
let owner = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Returns a token so a hidden route can release only the overlay it published. */
export function publishMapOverlay(overlay: MapOverlay) {
  const token = ++generation;
  owner = token;
  if (overlay !== current) {
    current = overlay;
    emit();
  }
  return token;
}

/**
 * Drops the overlay after the current effect flush.
 * A newer publish during that flush keeps the map, which is what happens when
 * one section hides and the next section publishes in the same navigation.
 */
export function releaseMapOverlay(token: number) {
  queueMicrotask(() => {
    if (token !== owner || current === EMPTY_OVERLAY) return;
    current = EMPTY_OVERLAY;
    emit();
  });
}

export function subscribeMapOverlay(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMapOverlay() {
  return current;
}

export function getServerMapOverlay() {
  return EMPTY_OVERLAY;
}
