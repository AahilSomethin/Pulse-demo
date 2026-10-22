import { describe, expect, it } from "vitest";

import { getMapOverlay, publishMapOverlay, releaseMapOverlay } from "@/lib/workspace/overlay";
import { EMPTY_OVERLAY, type MapOverlay } from "@/types/map";

const incident: MapOverlay = { clickMode: "incident", markers: [], lines: [] };
const vessels: MapOverlay = { clickMode: "vessel", markers: [], lines: [] };

describe("map overlay ownership", () => {
  it("keeps the newer section when an older publish is released", async () => {
    const older = publishMapOverlay(vessels);
    const newer = publishMapOverlay(incident);
    releaseMapOverlay(older);
    releaseMapOverlay(newer);
    await Promise.resolve();
    expect(getMapOverlay()).toBe(EMPTY_OVERLAY);
    const kept = publishMapOverlay(incident);
    publishMapOverlay(vessels);
    releaseMapOverlay(kept);
    await Promise.resolve();
    expect(getMapOverlay()).toBe(vessels);
  });
});
