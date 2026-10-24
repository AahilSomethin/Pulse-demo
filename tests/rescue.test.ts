import { describe, expect, it } from "vitest";

import { distanceM, distanceToSegmentM } from "@/lib/geo/distance";
import { boatLabel, boatRoster, passesNearIncident } from "@/lib/simulation/rescue";
import type { Dwell, Journey } from "@/types/maritime";

function dwell(lat: number, lon: number, name: string | null, areaId: string): Dwell {
  return {
    device: 0,
    startMs: 0,
    endMs: 1_000,
    lat,
    lon,
    pingCount: 4,
    islandId: name,
    islandName: name,
    areaId,
    areaLabel: `Inferred area ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`,
    areaLat: lat,
    areaLon: lon,
    atoll: null,
    confidence: name ? "named_polygon" : "inferred",
    placeName: null,
    placeSourceId: null,
  };
}

function passage(input: {
  device?: number;
  originLat: number;
  originLon: number;
  destinationLat: number;
  destinationLon: number;
  originName?: string | null;
  destinationName?: string | null;
  credible?: boolean;
}): Journey {
  return {
    device: input.device ?? 1,
    origin: { ...dwell(input.originLat, input.originLon, input.originName ?? "North", "a"), endMs: 1_000 },
    destination: { ...dwell(input.destinationLat, input.destinationLon, input.destinationName ?? "South", "b"), startMs: 2_000 },
    durationMs: 1_000,
    straightLineM: 10_000,
    pathM: 10_000,
    pingsBetween: 4,
    maxGapMs: 1_000,
    impliedKn: 10,
    flags: [],
    coverageGap: false,
    credible: input.credible ?? true,
  };
}

describe("rescue consent", () => {
  it("measures distance to the segment and clamps past the end", () => {
    const beside = distanceToSegmentM(73.05, 4.05, 73, 4, 73, 4.1);
    expect(beside).toBeGreaterThan(5_000);
    expect(beside).toBeLessThan(6_000);
    expect(distanceToSegmentM(73, 4.05, 73, 4, 73, 4.1)).toBeLessThan(1);
    const pastEnd = distanceToSegmentM(73.2, 4.05, 73, 4, 73.1, 4);
    expect(pastEnd).toBeCloseTo(distanceM(73.1, 4, 73.2, 4.05), -1);
  });

  it("asks only the selected boat about a credible route inside the radius", () => {
    const near = passage({ originLat: 4, originLon: 73, destinationLat: 4.1, destinationLon: 73 });
    const otherBoat = passage({ device: 2, originLat: 4, originLon: 73, destinationLat: 4.1, destinationLon: 73 });
    const gap = passage({
      originLat: 4,
      originLon: 73,
      destinationLat: 4.1,
      destinationLon: 73,
      credible: false,
    });
    const far = passage({
      originLat: 5,
      originLon: 73,
      destinationLat: 5.1,
      destinationLon: 73,
      originName: "Far",
      destinationName: "Away",
    });
    const journeys = [gap, far, otherBoat, near];
    const passes = passesNearIncident(journeys, 1, { lat: 4.05, lon: 73 }, 1_000);
    expect(passes).toHaveLength(1);
    expect(passes[0]?.label).toBe("North to South");
    expect(passes[0]?.distanceM).toBeLessThan(1);
    expect(passesNearIncident(journeys, 1, { lat: 4.05, lon: 73.2 }, 5_000)).toEqual([]);
    expect(boatRoster(journeys)).toEqual([1, 2]);
    expect(boatLabel([1, 2], 2, "1234567890")).toBe("Boat 2 · Device ••••7890");
  });

  it("orders the closest passing route first", () => {
    const close = passage({ originLat: 4, originLon: 73, destinationLat: 4.1, destinationLon: 73, originName: "Close", destinationName: "Stop" });
    const wider = passage({
      originLat: 4,
      originLon: 73.02,
      destinationLat: 4.1,
      destinationLon: 73.02,
      originName: "Wider",
      destinationName: "Stop",
    });
    const passes = passesNearIncident([wider, close], 1, { lat: 4.05, lon: 73 }, 5_000);
    expect(passes.map((item) => item.label)).toEqual(["Close to Stop", "Wider to Stop"]);
  });
});