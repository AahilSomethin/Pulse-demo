import { describe, expect, it } from "vitest";

import { ANOMALY } from "@/config/constants";
import { findPassageOutliers, type CohortBaseline } from "@/lib/analytics/anomalies";
import { filterIndicators } from "@/lib/analytics/filters";
import { classifyOutlier, findingTitle, reviewFirst } from "@/lib/analytics/review-priority";
import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import type { Dwell, Journey } from "@/types/maritime";
import { connectionId, type NetworkFilters } from "@/lib/workspace/state";

function dwell(areaId: string, name: string | null): Dwell {
  return {
    device: 0,
    startMs: 0,
    endMs: 1_000,
    lat: 4,
    lon: 73,
    pingCount: 4,
    islandId: name,
    islandName: name,
    areaId,
    areaLabel: "area",
    areaLat: 4,
    areaLon: 73,
    atoll: null,
    confidence: name ? "named_polygon" : "inferred",
    placeName: null,
    placeSourceId: null,
  };
}

function passage(input: {
  minutes: number;
  device?: number;
  pathM: number;
  straightM?: number;
  gapMin?: number;
  pings?: number;
  origin?: string;
  destination?: string;
}): Journey {
  const straightLineM = input.straightM ?? input.pathM;
  return {
    device: input.device ?? 0,
    origin: { ...dwell(input.origin ?? "a", "North"), endMs: 0 },
    destination: { ...dwell(input.destination ?? "b", "South"), startMs: input.minutes * 60_000 },
    durationMs: input.minutes * 60_000,
    straightLineM,
    pathM: input.pathM,
    pingsBetween: input.pings ?? 8,
    maxGapMs: (input.gapMin ?? 1) * 60_000,
    impliedKn: 10,
    flags: [],
    coverageGap: false,
    credible: true,
  };
}

const SPREAD = [20, 22, 24, 26, 28, 30, 32, 34, 36];

function spread(extra: Journey, origin = "a", destination = "b"): Journey[] {
  const journeys = SPREAD.map((minutes, index) => passage({
    minutes,
    device: index % 3,
    pathM: 20_000,
    straightM: 18_000,
    origin,
    destination,
  }));
  journeys.push(extra);
  return journeys;
}

describe("review priority", () => {
  it("keeps a well tracked long journey and sets aside a reporting hole", () => {
    const clear = findPassageOutliers(spread(passage({ minutes: 180, device: 4, pathM: 22_000, straightM: 18_000 })));
    expect(clear.outliers).toHaveLength(1);
    expect(classifyOutlier(clear.outliers[0]).tier).toBe("investigate");
    expect(findingTitle(clear.outliers[0].kind)).toBe("Unusually slow journey");

    const hole = findPassageOutliers(spread(passage({
      minutes: 180,
      device: 4,
      pathM: 22_000,
      straightM: 18_000,
      gapMin: 80,
    })));
    expect(classifyOutlier(hole.outliers[0]).tier).toBe("data_issue");
    expect(classifyOutlier(hole.outliers[0]).notes[0]).toContain("hole");
  });

  it("does not promote a journey that matches the device’s own typical time", () => {
    const journeys = spread(passage({ minutes: 30, device: 1, pathM: 20_000 }));
    journeys.push(
      passage({ minutes: 170, device: 5, pathM: 22_000, straightM: 18_000 }),
      passage({ minutes: 180, device: 5, pathM: 22_000, straightM: 18_000 }),
      passage({ minutes: 190, device: 5, pathM: 22_000, straightM: 18_000 }),
    );
    const review = findPassageOutliers(journeys);
    const own = review.outliers.filter((item) => item.device === 5);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((item) => classifyOutlier(item).tier === "insufficient")).toBe(true);
  });

  it("shows at most one journey per connection and prefers a repeated connection", () => {
    const cohort = (origin: string, destination: string): CohortBaseline => ({
      id: connectionId("inferred_activity", origin, destination),
      durationsMs: SPREAD.map((minutes) => minutes * 60_000),
      vessels: 6,
      medianDistanceM: 18_000,
      medianPathRatio: 1.1,
    });
    const local = [
      passage({ minutes: 180, device: 4, pathM: 22_000, straightM: 18_000, origin: "a", destination: "b" }),
      passage({ minutes: 170, device: 5, pathM: 22_000, straightM: 18_000, origin: "a", destination: "b" }),
      passage({ minutes: 200, device: 4, pathM: 40_000, straightM: 12_000, pings: 12, origin: "c", destination: "d" }),
    ];
    const picks = reviewFirst(findPassageOutliers(local, [cohort("a", "b"), cohort("c", "d")]).outliers, 3);
    expect(picks).toHaveLength(2);
    expect(new Set(picks.map((item) => item.outlier.connectionId)).size).toBe(picks.length);
    expect(picks[0].outlier.connectionId).toBe(connectionId("inferred_activity", "a", "b"));
    expect(picks[0].tier).toBe("investigate");
    expect(ANOMALY.minPassages).toBe(8);
  });

  it("sets aside a barely moving passage and an extreme path", () => {
    const stopped = findPassageOutliers([
      ...SPREAD.map((minutes, index) => passage({ minutes, device: index % 3, pathM: 20_000, straightM: 18_000 })),
      passage({ minutes: 200, device: 4, pathM: 1_000, straightM: 10_000 }),
    ]);
    expect(stopped.outliers[0].kind).toBe("stationary");
    expect(classifyOutlier(stopped.outliers[0]).tier).toBe("data_issue");
    const wild = findPassageOutliers([
      ...SPREAD.map((minutes, index) => passage({ minutes, device: index % 3, pathM: 20_000, straightM: 18_000 })),
      passage({ minutes: 90, device: 4, pathM: 80_000, straightM: 10_000, pings: 20 }),
    ]);
    expect(wild.outliers[0].pathRatio).toBeGreaterThanOrEqual(6);
    expect(classifyOutlier(wild.outliers[0]).tier).toBe("data_issue");
  });

  it("does not let the display minimum hide an anomaly review", () => {
    const filters: NetworkFilters = {
      scope: "day",
      minPassages: 50,
      minDurationMin: 0,
      maxDurationMin: 0,
      geoClass: "all",
      evidence: "adequate",
      minVariability: 0,
      atoll: "",
    };
    const indicator = {
      id: "pair",
      passages: 9,
      evidence: "limited",
      medianDurationMs: 20 * 60_000,
      origin: { atoll: null, confidence: "named_polygon" },
      destination: { atoll: null, confidence: "named_polygon" },
    } as ConnectionIndicator;
    expect(filterIndicators([indicator], filters)).toHaveLength(0);
    expect(filterIndicators([indicator], filters, { forAnomalyReview: true })).toHaveLength(1);
  });
});
