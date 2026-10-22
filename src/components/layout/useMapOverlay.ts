"use client";

import { useEffect } from "react";

import { publishMapOverlay, releaseMapOverlay } from "@/lib/workspace/overlay";
import type { MapOverlay } from "@/types/map";

/** Publishes the active section's markers and lines onto the persistent map. */
export function useMapOverlay(overlay: MapOverlay) {
  useEffect(() => {
    const token = publishMapOverlay(overlay);
    return () => releaseMapOverlay(token);
  }, [overlay]);
}
