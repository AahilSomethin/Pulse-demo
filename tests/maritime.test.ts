import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { aggregateAreaLinks, aggregateLinks, lowConnectivity } from "@/lib/analytics/network";
import { inferJourneys } from "@/lib/analytics/journeys";
import { parseCsv } from "@/lib/parsing/csv";
import { parseGeoJson } from "@/lib/parsing/geojson";
import { buildDataset } from "@/lib/vessels/dataset";
import { advanceCursor, buildSpeedMask, computeFrame, initialCursor } from "@/lib/vessels/frame";
import { hubFillOpacity, hubLineOpacity } from "@/lib/vessels/hub-style";
import { compareResponses } from "@/lib/simulation/emergency";
import { describeObservation, simulateConnection } from "@/lib/simulation/routes";

const csv = readFileSync(resolve(process.cwd(), "public/fixtures/synthetic-followme.csv"), "utf8");
const geo = readFileSync(resolve(process.cwd(), "public/fixtures/synthetic-islands.geojson"), "utf8");

describe("parseCsv", () => {
  it("keeps Maldives rows and rejects the rest", () => {
    const parsed = parseCsv(csv);
    expect(parsed.headerMode).toBe("named");
    expect(parsed.rows).toHaveLength(16);
    expect(parsed.rejected.outOfBox).toBe(1);
    expect(parsed.rejected.badTime).toBe(1);
    const dataset = buildDataset(parsed, "synthetic-followme.csv");
    expect(dataset.synthetic).toBe(true);
    expect(dataset.names).toEqual(["111", "333", "222"]);
    expect(dataset.tracks[0]).toHaveLength(9);
  });

  it("reads the headerless column positions and treats speed as a raw number", () => {
    const parsed = parseCsv("x,111,y,2024-01-01 00:00:00,4.175,73.510,-1.5\n");
    expect(parsed.headerMode).toBe("positional");
    expect(parsed.rows[0].imei).toBe("111");
    expect(parsed.rows[0].speed).toBe(-1.5);
    expect(parsed.rows[0].lat).toBeCloseTo(4.175, 4);
    expect(parsed.rows[0].lon).toBeCloseTo(73.51, 4);
  });

  it("parses an explicit offset and still reads a naive timestamp as UTC", () => {
    const zoned = parseCsv("imei,device_date,latitude,longitude,speed\n111,2024-01-01 00:00:00+05:00,4.175,73.510,1\n");
    expect(zoned.rows).toHaveLength(1);
    expect(zoned.rows[0].timeMs).toBe(Date.parse("2023-12-31T19:00:00Z"));
    const naive = parseCsv("imei,device_date,latitude,longitude,speed\n111,2024-01-01 00:00:00,4.175,73.510,1\n");
    expect(naive.rows[0].timeMs).toBe(Date.parse("2024-01-01T00:00:00Z"));
    const suffixed = parseCsv("imei,device_date,latitude,longitude,speed\n111,2024-01-01 00:00:00Z,4.175,73.510,1\n");
    expect(suffixed.rows[0].timeMs).toBe(Date.parse("2024-01-01T00:00:00Z"));
  });

  it("reads quoted FollowMe columns, drops a duplicate, and breaks ties with timestamp", () => {
    const text = [
      "poll_id,imei,timestamp,device_date,latitude,longitude,speed,heading,network,cellid,gsm_level",
      '1,100000000000001,"2025-08-01 00:00:40","2025-08-01 00:00:30",4.180,73.510,0,10,1,1,3',
      '2,100000000000001,"2025-08-01 00:00:10","2025-08-01 00:00:30",4.181,73.511,1,20,2,2,4',
      '3,100000000000001,"2025-08-01 00:00:10","2025-08-01 00:00:30",4.181,73.511,1,20,2,2,4',
    ].join("\n");
    const parsed = parseCsv(text);
    expect(parsed.headerMode).toBe("named");
    expect(parsed.rejected.duplicate).toBe(1);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].lon).toBeCloseTo(73.511);
    expect(parsed.rows[0].savedMs).toBeLessThan(parsed.rows[1].savedMs);
    const dataset = buildDataset(parsed, "august-day.csv");
    expect(dataset.synthetic).toBe(false);
    expect(dataset.periodLabel).toBe("August 2025");
    expect(dataset.quality.network).toMatchObject({ dhiraagu: 1, ooredoo: 1 });
    expect(dataset.quality.zeroDurationMoves).toBe(1);
  });

  it("counts a same-timestamp position change as unresolved", () => {
    const text = [
      "imei,timestamp,device_date,latitude,longitude,speed",
      '1,"2025-08-01 00:00:00","2025-08-01 00:00:00",4.18,73.51,0',
      '1,"2025-08-01 00:00:00","2025-08-01 00:00:00",4.20,73.53,0',
    ].join("\n");
    const dataset = buildDataset(parseCsv(text), "august-day.csv");
    expect(dataset.quality.zeroDurationMoves).toBe(1);
    expect(dataset.quality.implausibleJumps).toBe(0);
  });

  it("strips a BOM and still finds the named header", () => {
    const parsed = parseCsv("\uFEFFimei,device_date,latitude,longitude,speed\n111,2024-01-01 00:00:00,4.175,73.510,0\n");
    expect(parsed.headerMode).toBe("named");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].speed).toBe(0);
  });
});

describe("activity frame", () => {
  const dataset = buildDataset(parseCsv(csv), "synthetic-followme.csv");
  const cursor = Date.parse("2024-01-01T00:15:00Z");

  it("places the opening frame one window after the first ping", () => {
    expect(initialCursor(dataset.t0, dataset.t1, 900_000)).toBe(dataset.t0 + 900_000);
  });

  it("keeps moving a long file forward by a fraction of the window", () => {
    const t0 = 0;
    const t1 = 10 * 24 * 60 * 60 * 1000;
    const next = advanceCursor(t0, t0, t1, 900_000);
    expect(next - t0).toBe(150_000);
  });

  it("counts unique stopped devices in the same cell", () => {
    const mask = buildSpeedMask(dataset, 0);
    const frame = computeFrame(dataset, cursor, 900_000, 0.02, "stop", mask, -1);
    expect(frame.pingCount).toBe(10);
    expect(frame.positions).toHaveLength(3);
    expect(frame.topHubs).toHaveLength(1);
    expect(frame.topHubs[0].devices).toBe(2);
    expect(frame.topHubs[0].alpha).toBe(1);
    expect(frame.topHubs[0].centerLat).toBeCloseTo(4.17, 5);
    expect(frame.topHubs[0].centerLon).toBeCloseTo(73.51, 5);
  });

  it("keeps a device only after three pings at or above the threshold, unless it is selected", () => {
    const mask = buildSpeedMask(dataset, 10);
    expect(Array.from(mask)).toEqual([0, 1, 0]);
    const hidden = computeFrame(dataset, cursor, 900_000, 0.02, "move", mask, -1);
    expect(hidden.positions.map((item) => dataset.names[item.device])).toEqual(["333"]);
    const forced = computeFrame(dataset, cursor, 900_000, 0.02, "stop", mask, 0);
    expect(forced.positions.some((item) => item.device === 0)).toBe(true);
  });
});

describe("hub display opacity", () => {
  it("keeps a soft fill, in order, with the hot end pulled away from quiet cells", () => {
    const quiet = hubFillOpacity(0, 100);
    const quarter = hubFillOpacity(25, 100);
    const peak = hubFillOpacity(100, 100);
    expect(quiet).toBeCloseTo(0.03, 5);
    expect(peak).toBeCloseTo(0.22, 5);
    expect(peak).toBeLessThanOrEqual(0.25);
    expect(hubFillOpacity(1, 100)).toBeGreaterThan(quiet);
    expect(hubFillOpacity(1, 100)).toBeLessThan(quarter);
    expect(quarter).toBeLessThan(peak);
    expect(quarter - quiet).toBeLessThan(peak - quarter);
  });

  it("keeps cell outlines inside the 25–50% band", () => {
    expect(hubLineOpacity(1, 100, "dark")).toBeGreaterThanOrEqual(0.25);
    expect(hubLineOpacity(100, 100, "dark")).toBeLessThanOrEqual(0.5);
    expect(hubLineOpacity(1, 100, "light")).toBeGreaterThanOrEqual(0.25);
    expect(hubLineOpacity(100, 100, "light")).toBeCloseTo(0.5, 5);
    expect(hubLineOpacity(10, 100, "dark")).toBeLessThan(hubLineOpacity(100, 100, "dark"));
    expect(hubLineOpacity(10, 100, "light")).toBeGreaterThan(hubLineOpacity(10, 100, "dark"));
  });
});

describe("geography and journeys", () => {
  const dataset = buildDataset(parseCsv(csv), "synthetic-followme.csv");
  const geography = parseGeoJson(geo);

  it("draws polygons and keeps only declared facilities", () => {
    expect(geography.polygons.map((polygon) => polygon.name)).toEqual(["Synthetic North", "Synthetic South", "Synthetic Quiet"]);
    expect(geography.facilities.map((facility) => facility.name).sort()).toEqual(["Synthetic Clinic", "Synthetic Coast Guard"]);
    expect(geography.facilities.every((facility) => facility.verified && facility.synthetic)).toBe(true);
  });

  it("builds one observed passage and leaves the quiet polygon unlinked", () => {
    const journeys = inferJourneys(dataset, geography.polygons);
    const credible = journeys.filter((journey) => !journey.coverageGap);
    expect(credible).toHaveLength(1);
    expect(credible[0].origin.islandName).toBe("Synthetic North");
    expect(credible[0].destination.islandName).toBe("Synthetic South");
    expect(credible[0].durationMs).toBe(45 * 60 * 1000);
    const links = aggregateLinks(journeys);
    expect(links).toHaveLength(1);
    expect(links[0].tripCount).toBe(1);
    const quiet = lowConnectivity(geography.polygons, links).find((item) => item.name === "Synthetic Quiet");
    expect(quiet?.observedLinks).toBe(0);
    expect(links[0].placeKind).toBe("named_island");
    const areas = aggregateAreaLinks(journeys);
    expect(areas[0].placeKind).toBe("inferred_activity");
    expect(areas[0].origin.startsWith("Inferred area")).toBe(true);
    expect(areas[0].origin).not.toBe("Synthetic North");
  });

  it("does not turn an unnamed cluster into an island", () => {
    const journeys = inferJourneys(dataset, []);
    expect(journeys.filter((journey) => !journey.coverageGap)[0].origin.islandName).toBeNull();
    expect(aggregateLinks(journeys)).toHaveLength(0);
    expect(aggregateAreaLinks(journeys).length).toBeGreaterThan(0);
  });

  it("flags an implausible jump as a coverage gap", () => {
    const text = [
      "imei,device_date,latitude,longitude,speed",
      "1,2024-01-01 00:00:00,4.00,73.60,0",
      "1,2024-01-01 00:10:00,4.00,73.60,0",
      "1,2024-01-01 00:12:00,6.50,73.60,0",
      "1,2024-01-01 00:22:00,6.50,73.60,0",
    ].join("\n");
    const journeys = inferJourneys(buildDataset(parseCsv(text), "gap.csv"), []);
    expect(journeys).toHaveLength(1);
    expect(journeys[0].coverageGap).toBe(true);
    expect(aggregateLinks(journeys)).toHaveLength(0);
  });
});

describe("experimental estimates", () => {
  const dataset = buildDataset(parseCsv(csv), "synthetic-followme.csv");
  const geography = parseGeoJson(geo);
  const cursor = Date.parse("2024-01-01T00:15:00Z");
  const frame = computeFrame(dataset, cursor, 900_000, 0.02, "all", buildSpeedMask(dataset, 0), -1);

  it("compares observed positions with a verified Coast Guard site", () => {
    const options = compareResponses({
      dataset,
      frame,
      incident: { lat: 4.175, lon: 73.51 },
      radiusM: 30_000,
      vesselSpeedKn: 12,
      coastGuardSpeedKn: 25,
      facilities: geography.facilities,
      hypotheticalCoastGuard: { lat: 4.2, lon: 73.5 },
    });
    expect(options.some((option) => option.evidence === "observed_position" && option.speedSource === "reported_ping")).toBe(true);
    expect(options.some((option) => option.evidence === "verified_coast_guard")).toBe(true);
    expect(options.some((option) => option.evidence === "hypothetical_coast_guard")).toBe(true);
    expect(options.every((option) => option.medicalName === "Synthetic Clinic")).toBe(true);
    const ranked = options.map((option) => option.combinedMin ?? Infinity);
    expect(ranked).toEqual([...ranked].sort((a, b) => a - b));
  });

  it("differences a proposed time from the observed median", () => {
    const links = aggregateLinks(inferJourneys(dataset, geography.polygons));
    const comparison = simulateConnection(links[0], "Synthetic North", "Synthetic South", 30);
    expect(comparison.observedTrips).toBe(1);
    expect(comparison.observedMedianMin).toBe(45);
    expect(comparison.differenceMin).toBe(15);
    const observed = describeObservation(links[0], dataset.quality.medianMovingKn);
    expect(observed.placeKind).toBe("named_island");
    expect(observed.observedTrips).toBe(1);
    expect(observed.observedMedianMin).toBe(45);
    expect(observed.straightLineMin).not.toBeNull();
    expect(observed.extraMin).not.toBeNull();
  });

  it("rejects invalid geography", () => {
    expect(() => parseGeoJson("{")).toThrow(/Not valid GeoJSON/);
  });

  it("rejects a csv with no usable rows", () => {
    expect(() => buildDataset(parseCsv("imei,device_date,latitude,longitude,speed\n"), "empty.csv")).toThrow(/No valid rows/);
  });
});
