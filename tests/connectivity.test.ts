import { describe, expect, it } from "vitest";

import { buildConnectionIndicators } from "@/lib/analytics/connectivity";
import { connectivityCsv } from "@/lib/analytics/export-report";
import { summarizeFrequency } from "@/lib/analytics/frequency";
import { connectionOverlay, visibleConnectionLines } from "@/lib/analytics/map-links";
import { emptyCarry, finish, ingest } from "@/lib/analytics/passages";
import { findOpportunities } from "@/lib/analytics/opportunities";
import { indicatorsFromMonth, sameIslandPassageCount, type StoredConnection, type StoredMonth } from "@/lib/analytics/month";
import { countSameIslandJourneys } from "@/lib/analytics/same-island";
import { searchPlaces } from "@/lib/search/query";
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
      credibleVessels: 4,
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

describe("same-island cells", () => {
  const thilafushi: LandPolygon = {
    id: "thilafushi",
    name: "Thilafushi",
    nameDv: "ތިލަފުށި",
    atoll: "K",
    rings: [[[73.4, 4.16], [73.55, 4.16], [73.55, 4.26], [73.4, 4.26], [73.4, 4.16]]],
    synthetic: true,
  };

  it("keeps a Thilafushi cell pair out of inter-island connections", () => {
    const locator = createPlaceLocator([thilafushi], []);
    const carry = emptyCarry();
    ingest(carry, [
      sample("2025-08-01T00:00:00Z", 4.181, 73.45),
      sample("2025-08-01T00:12:00Z", 4.181, 73.45),
      sample("2025-08-01T00:20:00Z", 4.2, 73.45, 8),
      sample("2025-08-01T00:40:00Z", 4.23, 73.45),
      sample("2025-08-01T00:52:00Z", 4.23, 73.45),
    ], locator, 7);
    const journeys = finish(carry, locator, 7);
    expect(journeys).toHaveLength(1);
    expect(journeys[0].flags).toContain("same_island");
    expect(journeys[0].credible).toBe(false);
    expect(journeys[0].origin.areaId).not.toBe(journeys[0].destination.areaId);
    expect(journeys[0].origin.areaLat).not.toBe(journeys[0].origin.lat);
    const indicators = buildConnectionIndicators(journeys, { scope: "day", periodLabel: "1 August 2025", observationDays: 1 });
    expect(indicators).toHaveLength(0);
    expect(countSameIslandJourneys(journeys)).toBe(1);
    expect(findOpportunities(indicators).flagged).toHaveLength(0);
  });

  it("keeps the same name in two atolls as a crossing", () => {
    const polygons: LandPolygon[] = [
      { id: "fun-k", name: "Funadhoo", atoll: "K", rings: [[[73.5, 4.1], [73.52, 4.1], [73.52, 4.12], [73.5, 4.12], [73.5, 4.1]]], synthetic: true },
      { id: "fun-sh", name: "Funadhoo", atoll: "Sh", rings: [[[73.1, 6.1], [73.12, 6.1], [73.12, 6.12], [73.1, 6.12], [73.1, 6.1]]], synthetic: true },
    ];
    const locator = createPlaceLocator(polygons, []);
    const carry = emptyCarry();
    ingest(carry, [
      sample("2025-08-01T01:00:00Z", 4.11, 73.51),
      sample("2025-08-01T01:12:00Z", 4.11, 73.51),
      sample("2025-08-01T02:00:00Z", 5.0, 73.3, 8),
      sample("2025-08-01T03:00:00Z", 6.11, 73.11),
      sample("2025-08-01T03:12:00Z", 6.11, 73.11),
    ], locator, 3);
    const journeys = finish(carry, locator, 3);
    expect(journeys[0]?.flags ?? []).not.toContain("same_island");
    const indicators = buildConnectionIndicators(journeys, { scope: "day", periodLabel: "1 August 2025", observationDays: 1 });
    expect(indicators.length).toBeGreaterThan(0);
    expect(indicators[0].origin.atoll).not.toBe(indicators[0].destination.atoll);
  });
});

describe("stored month same-island rows", () => {
  it("drops a same-source pair and counts its passages", () => {
    const same: StoredConnection = {
      originId: "80:1469",
      destinationId: "81:1469",
      originLabel: "Thilafushi · Inferred area 4.18°N, 73.48°E",
      destinationLabel: "Thilafushi · Inferred area 4.23°N, 73.48°E",
      originLat: 4.175,
      originLon: 73.475,
      destinationLat: 4.225,
      destinationLon: 73.475,
      originConfidence: "named_polygon",
      destinationConfidence: "named_polygon",
      originSourceId: "thilafushi",
      destinationSourceId: "thilafushi",
      originAtoll: "K",
      destinationAtoll: "K",
      vessels: 12,
      dayCounts: [2],
      durationSec: [600, 700],
      distanceM: [1100, 1100],
      pathRatio: [2, 2],
      excluded: 4,
    };
    const crossing: StoredConnection = {
      ...same,
      destinationId: "90:1400",
      destinationLabel: "Maafushi · Inferred area 3.93°N, 73.48°E",
      destinationLat: 3.925,
      destinationSourceId: "maafushi",
      destinationAtoll: "K",
      durationSec: [3000],
      excluded: 0,
    };
    const file: StoredMonth = {
      schema: 1,
      periodLabel: "August 2025",
      method: "pooled",
      generatedAt: "2026-01-01T00:00:00Z",
      days: [{ day: "1", rowsKept: 1, devices: 1 }],
      rowsKept: 1,
      devices: 1,
      minVessels: 3,
      connections: [same, crossing],
    };
    const indicators = indicatorsFromMonth(file);
    expect(indicators).toHaveLength(1);
    expect(indicators[0].destination.label.startsWith("Maafushi")).toBe(true);
    expect(indicators[0].credibleVessels).toBeNull();
    expect(sameIslandPassageCount(file)).toBe(6);
  });
});

describe("map overlay", () => {
  function line(id: string, confidence: ConnectionIndicator["origin"]["confidence"] = "inferred"): ConnectionIndicator {
    return {
      id,
      origin: { id: `${id}-o`, label: "Origin", lat: 4.175, lon: 73.475, confidence, sourceId: null, atoll: null },
      destination: { id: `${id}-d`, label: "Destination", lat: 4.225, lon: 73.525, confidence, sourceId: null, atoll: null },
      passages: 4,
      vessels: 2,
      credibleVessels: 2,
      attempted: 4,
      excluded: 0,
      activeDays: 1,
      dayCounts: [4],
      durationsMs: [600_000],
      medianDurationMs: 600_000,
      iqrMs: null,
      p90Ms: null,
      medianDistanceM: 5000,
      medianPathRatio: 1.1,
      evidence: "limited",
      scope: "day",
      periodLabel: "Day",
      observationDays: 1,
    };
  }

  it("keeps every overview line and uses the endpoint coordinates", () => {
    const overlay = connectionOverlay([line("a"), line("b", "named_polygon")], "b", "overview");
    expect(overlay.lines).toHaveLength(2);
    expect(overlay.lines[0].coordinates).toEqual([[73.475, 4.175], [73.525, 4.225]]);
    expect(overlay.lines.find((item) => item.id === "a")?.kind).toBe("inferred");
    expect(overlay.lines.find((item) => item.id === "b")?.kind).toBe("named");
    expect(overlay.lines.every((item) => item.gated === 1)).toBe(true);
    expect(overlay.hidden).toBe(0);
  });

  it("limits the drawn overview without dropping the published lines", () => {
    const lines = Array.from({ length: 30 }, (_, index) => ({
      id: `l${index}`,
      kind: "named" as const,
      coordinates: [[73.53, 4.17], [73 + index * 0.1, 5]] as [number, number][],
      active: false,
      rank: index,
      gated: 1,
      opacity: 0.55,
    }));
    const far = visibleConnectionLines(lines, 5);
    expect(far.length).toBeLessThanOrEqual(2);
    expect(far.every((line) => (line.rank ?? 0) < 2)).toBe(true);
    expect(visibleConnectionLines(lines, 13).length).toBeGreaterThan(far.length);
    expect(visibleConnectionLines(lines.map((line) => ({ ...line, gated: 0 })), 5)).toHaveLength(30);
    expect(visibleConnectionLines(lines.map((line) => (line.id === "l29" ? { ...line, active: true } : line)), 5).some((line) => line.id === "l29")).toBe(true);
  });

  it("fades an unselected opportunity line", () => {
    const overlay = connectionOverlay([line("a"), line("b")], "a", "opportunity");
    expect(overlay.lines.find((item) => item.id === "b")?.opacity).toBeLessThan(0.2);
    expect(overlay.locations.map((item) => item.id).sort()).toEqual(["a-d", "a-o"]);
  });
});

describe("search and frequency", () => {
  it("groups a shared island name and masks a vessel", () => {
    const polygons: LandPolygon[] = [
      { id: "a", name: "Funadhoo", nameDv: "ފުނަދޫ", atoll: "K", rings: [[[73, 4], [73.1, 4], [73.1, 4.1], [73, 4.1], [73, 4]]], synthetic: false },
      { id: "b", name: "Funadhoo", atoll: "Sh", rings: [[[73, 6], [73.1, 6], [73.1, 6.1], [73, 6.1], [73, 6]]], synthetic: false },
    ];
    const counts = new Map([["K", 1], ["Sh", 1]]);
    const shared = searchPlaces("funadhoo", { polygons, harbours: [], indicators: [], vesselNames: ["123456789012345"], polygonCountByAtoll: counts });
    const islands = shared.groups.find((group) => group.id === "island");
    expect(islands?.hits).toHaveLength(2);
    expect(islands?.hits.every((hit) => hit.ambiguous)).toBe(true);
    const dhivehi = searchPlaces("ފުނަދޫ", { polygons, harbours: [], indicators: [], vesselNames: null, polygonCountByAtoll: counts });
    expect(dhivehi.groups.find((group) => group.id === "island")?.hits[0].id).toBe("a");
    const hidden = searchPlaces("1234", { polygons, harbours: [], indicators: [], vesselNames: ["123456789012345"], polygonCountByAtoll: counts });
    const vessel = hidden.groups.find((group) => group.id === "vessel")?.hits[0];
    expect(vessel?.title).toBe("Device ••••2345");
    expect(vessel?.title).not.toContain("123456789012345");
    const short = searchPlaces("123", { polygons, harbours: [], indicators: [], vesselNames: ["123456789012345"], polygonCountByAtoll: counts });
    expect(short.groups.some((group) => group.id === "vessel")).toBe(false);
    const exact = searchPlaces("111", { polygons, harbours: [], indicators: [], vesselNames: ["111", "222"], polygonCountByAtoll: counts });
    expect(exact.groups.find((group) => group.id === "vessel")?.hits).toHaveLength(1);
    expect(exact.groups.find((group) => group.id === "vessel")?.hits[0].title).not.toContain("111");
  });

  it("does not rebuild a median for a partial day range", () => {
    const indicators = buildConnectionIndicators([], { scope: "month", periodLabel: "August 2025", observationDays: 2 });
    expect(indicators).toHaveLength(0);
    const summary = summarizeFrequency({
      indicators: [{
        id: "pair",
        origin: { id: "o", label: "A", lat: 1, lon: 73, confidence: "inferred", sourceId: null, atoll: null },
        destination: { id: "d", label: "B", lat: 2, lon: 73, confidence: "inferred", sourceId: null, atoll: null },
        passages: 3,
        vessels: 2,
        credibleVessels: 2,
        attempted: 3,
        excluded: 1,
        activeDays: 2,
        dayCounts: [1, 2],
        durationsMs: [10_000, 20_000, 30_000],
        medianDurationMs: 20_000,
        iqrMs: null,
        p90Ms: null,
        medianDistanceM: 1000,
        medianPathRatio: 1,
        evidence: "limited",
        scope: "month",
        periodLabel: "August 2025",
        observationDays: 2,
      }],
      dayFrom: 0,
      dayTo: 1,
    });
    expect(summary.passagesInRange).toBe(1);
    expect(summary.rangeIsFullWindow).toBe(false);
    expect(summary.medianDurationMs).toBe(20_000);
    const csv = connectivityCsv(summary ? [{
      id: "pair",
      origin: { id: "o", label: "A", lat: 1, lon: 73, confidence: "inferred", sourceId: null, atoll: null },
      destination: { id: "d", label: "B", lat: 2, lon: 73, confidence: "inferred", sourceId: null, atoll: null },
      passages: 3,
      vessels: 2,
      credibleVessels: 2,
      attempted: 3,
      excluded: 1,
      activeDays: 2,
      dayCounts: [1, 2],
      durationsMs: [10_000, 20_000, 30_000],
      medianDurationMs: 20_000,
      iqrMs: null,
      p90Ms: null,
      medianDistanceM: 1000,
      medianPathRatio: 1,
      evidence: "limited",
      scope: "month",
      periodLabel: "August 2025",
      observationDays: 2,
    }] : [], summary);
    expect(csv).not.toMatch(/latitude|longitude|imei/i);
    expect(csv).toContain("passages_in_selected_days");
    expect(csv).toContain("not a ferry timetable");
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
