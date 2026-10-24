import { describe, expect, it } from "vitest";

import { ANOMALY } from "@/config/constants";
import { findPassageOutliers, summariesFromDurations, type CohortBaseline } from "@/lib/analytics/anomalies";
import { medianAbsoluteDeviation } from "@/lib/analytics/stats";
import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import type { Dwell, Journey } from "@/types/maritime";

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
  device: number;
  pathM: number;
  straightM?: number;
  credible?: boolean;
}): Journey {
  const straightLineM = input.straightM ?? input.pathM;
  return {
    device: input.device,
    origin: { ...dwell("a", "North"), endMs: 0 },
    destination: { ...dwell("b", "South"), startMs: input.minutes * 60_000 },
    durationMs: input.minutes * 60_000,
    straightLineM,
    pathM: input.pathM,
    pingsBetween: 8,
    maxGapMs: 60_000,
    impliedKn: 10,
    flags: input.credible === false ? ["sparse_tracking"] : [],
    coverageGap: false,
    credible: input.credible !== false,
  };
}

const SPREAD = [20, 22, 24, 26, 28, 30, 32, 34, 36];

function spread(extra?: { minutes: number; pathM: number; straightM?: number; device?: number }): Journey[] {
  const journeys = SPREAD.map((minutes, index) => passage({
    minutes,
    device: index % 3,
    pathM: 20_000,
    straightM: 18_000,
  }));
  if (extra) {
    journeys.push(passage({
      minutes: extra.minutes,
      device: extra.device ?? 0,
      pathM: extra.pathM,
      straightM: extra.straightM,
    }));
  }
  return journeys;
}

describe("median absolute deviation", () => {
  it("is zero when every value matches the median", () => {
    expect(medianAbsoluteDeviation([30, 30, 30, 30])).toBe(0);
  });

  it("uses the median of absolute deviations", () => {
    expect(medianAbsoluteDeviation([10, 12, 14])).toBe(2);
  });
});

describe("passage outliers", () => {
  it("does not flag one long journey when the spread is zero", () => {
    const journeys = Array.from({ length: 9 }, (_, index) => passage({ minutes: 30, device: index % 3, pathM: 10_000 }));
    journeys.push(passage({ minutes: 400, device: 0, pathM: 500 }));
    expect(findPassageOutliers(journeys).outliers).toHaveLength(0);
  });

  it("holds back a cohort under 8 journeys or under 3 vessels", () => {
    const short = SPREAD.slice(0, 6).map((minutes, index) => passage({ minutes, device: index % 3, pathM: 20_000 }));
    short.push(passage({ minutes: 400, device: 0, pathM: 500 }));
    expect(findPassageOutliers(short).outliers).toHaveLength(0);
    const oneVessel = SPREAD.map((minutes) => passage({ minutes, device: 0, pathM: 20_000 }));
    oneVessel.push(passage({ minutes: 400, device: 0, pathM: 500 }));
    expect(findPassageOutliers(oneVessel).outliers).toHaveLength(0);
  });

  it("flags a barely moving journey and ignores a sparse one", () => {
    const journeys = spread({ minutes: 200, pathM: 1_000, straightM: 10_000 });
    journeys.push(passage({ minutes: 500, device: 1, pathM: 100, credible: false }));
    const review = findPassageOutliers(journeys);
    expect(review.outliers).toHaveLength(1);
    expect(review.outliers[0].kind).toBe("stationary");
    expect(review.outliers[0].robustZ).toBeGreaterThan(ANOMALY.robustZ);
    expect(review.outliers[0].what).toContain("North");
    expect(review.outliers[0].what).toContain("South");
    expect(review.outliers[0].investigate).toContain("not evidence of a breakdown");
    expect(review.summaries.values().next().value?.stationary).toBe(1);
  });

  it("separates a direct slow journey from a long path", () => {
    const slow = findPassageOutliers(spread({ minutes: 90, pathM: 12_000, straightM: 11_000 }));
    expect(slow.outliers.map((item) => item.kind)).toEqual(["slow_direct"]);
    const detour = findPassageOutliers(spread({ minutes: 90, pathM: 30_000, straightM: 10_000 }));
    expect(detour.outliers.map((item) => item.kind)).toEqual(["long_detour"]);
  });

  it("scores a loaded journey against a supplied August cohort", () => {
    const local = [passage({ minutes: 200, device: 4, pathM: 1_000, straightM: 10_000 })];
    const cohort: CohortBaseline = {
      id: local[0] ? `inferred_activity:a\u0000b` : "",
      durationsMs: SPREAD.map((minutes) => minutes * 60_000),
      vessels: 6,
      medianDistanceM: 18_000,
      medianPathRatio: 1.1,
    };
    const review = findPassageOutliers(local, [cohort]);
    expect(review.outliers).toHaveLength(1);
    expect(review.outliers[0].baseline).toBe("august_summary");
    expect(review.outliers[0].cohortVessels).toBe(6);
    expect(review.outliers[0].trackedSpeedBasis).toBe("typical_path");
    expect(review.outliers[0].evidence).toContain("August summary");
  });

  it("reports a device’s own typical time once it has three journeys", () => {
    const journeys = spread();
    journeys.push(
      passage({ minutes: 28, device: 5, pathM: 20_000 }),
      passage({ minutes: 30, device: 5, pathM: 20_000 }),
      passage({ minutes: 32, device: 5, pathM: 20_000 }),
      passage({ minutes: 200, device: 5, pathM: 1_000, straightM: 10_000 }),
    );
    const review = findPassageOutliers(journeys);
    const own = review.outliers.find((item) => item.device === 5);
    expect(own?.deviceMedianMs).not.toBeNull();
    expect(own?.evidence).toContain("own journeys");
  });

  it("counts August durations without claiming a movement pattern", () => {
    const durations = [...SPREAD, 200].map((minutes) => minutes * 60_000);
    const indicator = {
      id: "pair",
      passages: durations.length,
      vessels: 4,
      durationsMs: durations,
      evidence: "adequate",
      medianDurationMs: 30 * 60_000,
    } as ConnectionIndicator;
    const summary = summariesFromDurations([indicator]).get("pair");
    expect(summary?.movementKnown).toBe(false);
    expect(summary?.outliers).toBe(1);
    expect(summary?.stationary).toBe(0);
    expect(summary?.unusuallyLong).toBe(1);
  });
});
