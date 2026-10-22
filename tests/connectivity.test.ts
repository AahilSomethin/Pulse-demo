import { describe, expect, it } from "vitest";

import { buildConnectionIndicators } from "@/lib/analytics/connectivity";
import { emptyCarry, finish, ingest } from "@/lib/analytics/passages";
import { findOpportunities } from "@/lib/analytics/opportunities";
import { indicatorsFromMonth, type StoredConnection, type StoredMonth } from "@/lib/analytics/month";
import { quantile } from "@/lib/analytics/stats";
import { createPlaceLocator } from "@/lib/geo/matching";
import { locateIsland } from "@/lib/geo/point-in-polygon";
import { createPolygonIndex } from "@/lib/geo/spatial-index";
import { joinCensus, parseCensusCsv } from "@/lib/reference/census";
import { describeBaseline, compareScenario } from "@/lib/simulation/routes";
import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import type { LandPolygon } from "@/types/maritime";

const locate = createPlaceLocator([], []);

function sample(iso: string, lat: number, lon: number, speed = 0) {
  return { timeMs: Date.parse(iso), lat, lon, speed };
}

describe("day boundaries", () => {
  it("keeps one journey when the passage crosses midnight", () => {
    const carry = emptyCarry();
    ingest(carry, [
      sample("2025-08-01T23:40:00Z", 4, 73.5),
      sample("2025-08-01T23:50:00Z", 4, 73.5),
      sample("2025-08-01T23:58:00Z", 4.01, 73.52, 8),
    ], locate, 1);
    ingest(carry, [
      sample("2025-08-02T00:08:00Z", 4.02, 73.55, 8),
      sample("2025-08-02T00:20:00Z", 4.05, 73.6),
      sample("2025-08-02T00:30:00Z", 4.05, 73.6),
      sample("2025-08-02T00:40:00Z", 4.05, 73.6),
    ], locate, 1);
    const journeys = finish(carry, locate, 1);
    expect(journeys).toHaveLength(1);
    expect(journeys[0].origin.startMs).toBe(Date.parse("2025-08-01T23:40:00Z"));
    expect(journeys[0].destination.startMs).toBe(Date.parse("2025-08-02T00:20:00Z"));
    expect(journeys[0].credible).toBe(true);
  });

  it("does not split a dwell that is still open at midnight", () => {
    const carry = emptyCarry();
    ingest(carry, [
      sample("2025-08-01T23:50:00Z", 4, 73.5),
      sample("2025-08-01T23:55:00Z", 4, 73.5),
    ], locate, 1);
    expect(finish({ ...emptyCarry(), run: carry.run, last: carry.last, path: { ...carry.path } }, locate, 1)).toHaveLength(0);
    ingest(carry, [
      sample("2025-08-02T00:05:00Z", 4, 73.5),
      sample("2025-08-02T00:15:00Z", 4, 73.5),
      sample("2025-08-02T00:30:00Z", 4.05, 73.6, 8),
      sample("2025-08-02T00:45:00Z", 4.08, 73.7),
      sample("2025-08-02T00:55:00Z", 4.08, 73.7),
      sample("2025-08-02T01:05:00Z", 4.08, 73.7),
    ], locate, 1);
    const journeys = finish(carry, locate, 1);
    expect(journeys).toHaveLength(1);
    expect(journeys[0].origin.startMs).toBe(Date.parse("2025-08-01T23:50:00Z"));
    expect(journeys[0].origin.endMs).toBe(Date.parse("2025-08-02T00:15:00Z"));
  });

  it("drops the journey if each day is closed on its own", () => {
    const first = emptyCarry();
    ingest(first, [
      sample("2025-08-01T23:40:00Z", 4, 73.5),
      sample("2025-08-01T23:50:00Z", 4, 73.5),
    ], locate, 1);
    finish(first, locate, 1);
    const second = emptyCarry();
    ingest(second, [
      sample("2025-08-02T00:20:00Z", 4.05, 73.6),
      sample("2025-08-02T00:30:00Z", 4.05, 73.6),
      sample("2025-08-02T00:40:00Z", 4.05, 73.6),
    ], locate, 1);
    expect(finish(second, locate, 1)).toHaveLength(0);
  });
});

describe("pooled durations", () => {
  it("does not average daily medians", () => {
    const daily = [quantile([10, 10, 10], 0.5), quantile([10, 50, 100], 0.5)];
    const averaged = ((daily[0] ?? 0) + (daily[1] ?? 0)) / 2;
    const pooled = quantile([10, 10, 10, 10, 50, 100], 0.5);
    expect(averaged).toBe(30);
    expect(pooled).toBe(10);
  });

  it("rebuilds the month median from the stored seconds", () => {
    const connection: StoredConnection = {
      originId: "1:1",
      destinationId: "2:2",
      originLabel: "A",
      destinationLabel: "B",
      originLat: 4,
      originLon: 73,
      destinationLat: 4.2,
      destinationLon: 73.2,
      originConfidence: "inferred",
      destinationConfidence: "inferred",
      originSourceId: null,
      destinationSourceId: null,
      originAtoll: null,
      destinationAtoll: null,
      vessels: 4,
      dayCounts: [3, 3],
      durationSec: [10, 10, 10, 10, 50, 100],
      distanceM: [1000, 1000, 1000, 1000, 1000, 1000],
      pathRatio: [1, 1, 1, 1, 1, 1],
      excluded: 1,
    };
    const file: StoredMonth = {
      schema: 1,
      periodLabel: "August 2025",
      method: "pooled",
      generatedAt: "2026-01-01T00:00:00Z",
      days: [{ day: "1", rowsKept: 1, devices: 1 }, { day: "2", rowsKept: 1, devices: 1 }],
      rowsKept: 2,
      devices: 1,
      minVessels: 3,
      connections: [connection],
    };
    const [indicator] = indicatorsFromMonth(file);
    expect(indicator.medianDurationMs).toBe(10_000);
    expect(indicator.iqrMs).not.toBeNull();
    expect(indicator.p90Ms).toBeNull();
  });
});

describe("opportunities", () => {
  function indicator(patch: Partial<ConnectionIndicator>): ConnectionIndicator {
    return {
      id: "a",
      origin: { id: "o", label: "Origin", lat: 4, lon: 73, confidence: "inferred", sourceId: null, atoll: null },
      destination: { id: "d", label: "Destination", lat: 4.2, lon: 73.2, confidence: "inferred", sourceId: null, atoll: null },
      passages: 12,
      vessels: 4,
      attempted: 12,
      excluded: 0,
      activeDays: 8,
      dayCounts: [1, 1, 1, 1, 1, 1, 1, 5],
      durationsMs: [10, 10, 10, 10, 10, 10, 80, 80, 80, 80, 80, 80].map((minutes) => minutes * 60_000),
      medianDurationMs: 45 * 60_000,
      iqrMs: 70 * 60_000,
      p90Ms: 80 * 60_000,
      medianDistanceM: 10_000,
      medianPathRatio: 1.1,
      evidence: "adequate",
      scope: "month",
      periodLabel: "August 2025",
      observationDays: 8,
      ...patch,
    };
  }

  it("flags wide variation and holds back a small sample", () => {
    const result = findOpportunities([
      indicator({ id: "wide" }),
      indicator({ id: "small", evidence: "insufficient", passages: 2, vessels: 1 }),
    ]);
    expect(result.flagged.map((item) => item.indicator.id)).toContain("wide");
    expect(result.withheld.map((item) => item.id)).toEqual(["small"]);
    expect(result.flagged[0].rules.some((rule) => rule.id === "variable")).toBe(true);
    expect(result.flagged[0].caveats.length).toBeGreaterThan(0);
  });

  it("leaves a steady connection unranked", () => {
    const steady = indicator({
      id: "steady",
      durationsMs: Array.from({ length: 12 }, () => 30 * 60_000),
      medianDurationMs: 30 * 60_000,
      iqrMs: 0,
      p90Ms: 30 * 60_000,
      dayCounts: [2, 2, 1, 1, 2, 2, 1, 1],
      medianPathRatio: 1.1,
      excluded: 0,
      attempted: 12,
    });
    expect(findOpportunities([steady]).flagged).toHaveLength(0);
  });
});

describe("reference matching", () => {
  const polygons: LandPolygon[] = [
    { id: "near", name: "Near", atoll: "Test", rings: [[[73, 4], [73.2, 4], [73.2, 4.2], [73, 4.2], [73, 4]]], synthetic: true },
    { id: "far", name: "Far", atoll: null, rings: [[[74, 5], [74.2, 5], [74.2, 5.2], [74, 5.2], [74, 5]]], synthetic: true },
  ];

  it("matches the linear island scan", () => {
    const index = createPolygonIndex(polygons);
    expect(index.locate(73.1, 4.1)).toEqual(locateIsland(polygons, 73.1, 4.1));
    expect(index.locate(70, 1)).toBeNull();
  });

  it("uses a harbour only when no named polygon contains the point", () => {
    const harbours = [{ id: "h1", name: "Jetty", lat: 3, lon: 72.8, sourceId: "osm-1" }];
    const matcher = createPlaceLocator(polygons, harbours);
    expect(matcher.locate(4.1, 73.1).confidence).toBe("named_polygon");
    expect(matcher.locate(3, 72.8).confidence).toBe("near_harbour");
    expect(matcher.locate(3, 72.8).harbourName).toBe("Jetty");
    expect(matcher.locate(1, 70).confidence).toBe("inferred");
  });
});

describe("census join", () => {
  it("matches a code before a name and leaves near misses unmatched", () => {
    const rows = parseCensusCsv("code,name,atoll,population\nA1,Thinadhoo,Gaafu Dhaalu,5000\nB2,Fares,Haa Alifu,800\n");
    const join = joinCensus([{ code: "A1", name: "Thinadhoo island" }, { name: "Fares" }, { name: "Farees" }], rows);
    expect(join.populationForIsland("Thinadhoo island")).toBe(5000);
    expect(join.populationForIsland("Fares")).toBe(800);
    expect(join.populationForIsland("Farees")).toBeNull();
    expect(join.unmatchedCensus).toEqual([]);
  });
});

describe("route baseline", () => {
  it("states the hypothetical difference without treating it as a schedule", () => {
    const [indicator] = buildConnectionIndicators([], { scope: "day", periodLabel: "Day", observationDays: 1 });
    expect(indicator).toBeUndefined();
    const baseline = describeBaseline(null);
    const scenario = compareScenario(baseline, 20);
    expect(scenario.versusMedianMin).toBeNull();
    expect(scenario.evidenceNeeded.some((line) => line.toLowerCase().includes("navigable"))).toBe(true);
  });
});
