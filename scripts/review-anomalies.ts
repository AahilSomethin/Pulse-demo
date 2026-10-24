/**
 * Streams each FollowMe day, scores credible journeys against the August cohort,
 * and prints a short review. Device identifiers and coordinates are not written.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { cohortFromIndicator, findPassageOutliers, type PassageOutlier } from "../src/lib/analytics/anomalies";
import { indicatorsFromMonth, parseStoredMonth } from "../src/lib/analytics/month";
import { classifyOutlier, reviewFirst } from "../src/lib/analytics/review-priority";
import { createPlaceLocator } from "../src/lib/geo/matching";
import { parseHarbourGeoJson } from "../src/lib/reference/harbours";
import { parseDataset } from "../src/lib/parsing/load-csv";
import { parseGeoJson } from "../src/lib/parsing/geojson";
import { emptyCarry, finish, ingest } from "../src/lib/analytics/passages";
import { quantile } from "../src/lib/analytics/stats";
import type { Journey } from "../src/types/maritime";

const directory = path.resolve("data/FollowMe/FollowMe_august_2025");
const monthPath = path.resolve("data/derived/connectivity-august-2025.json");

interface Compact {
  day: number;
  outlier: PassageOutlier;
  pings: number;
  vesselKey: number;
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

function labelOf(journey: Journey): string {
  const from = journey.origin.islandName ?? journey.origin.placeName ?? "activity area";
  const to = journey.destination.islandName ?? journey.destination.placeName ?? "activity area";
  return `${from} -> ${to}`;
}

async function main() {
  const month = parseStoredMonth(JSON.parse(await readFile(monthPath, "utf8")));
  const indicators = indicatorsFromMonth(month);
  const cohorts = indicators.flatMap((indicator) => {
    const cohort = cohortFromIndicator(indicator);
    return cohort ? [cohort] : [];
  });
  const islandText = await readOptional(path.resolve("public/reference/osm-islands.geojson"));
  const harbourText = await readOptional(path.resolve("public/reference/osm-harbours.geojson"));
  const polygons = islandText ? parseGeoJson(islandText).polygons : [];
  const harbours = harbourText ? parseHarbourGeoJson(harbourText) : [];
  const locate = createPlaceLocator(polygons, harbours);
  const names = (await readdir(directory))
    .filter((name) => /^\d+\.csv$/i.test(name))
    .sort((a, b) => Number(a.replace(/\.csv$/i, "")) - Number(b.replace(/\.csv$/i, "")));

  const vesselIds = new Map<string, number>();
  const history = new Map<string, Map<number, number[]>>();
  const found: Compact[] = [];
  let credible = 0;
  let flagged = 0;

  for (const name of names) {
    const day = Number(name.replace(/\.csv$/i, ""));
    const text = await readFile(path.join(directory, name), "utf8");
    const dataset = parseDataset(text, name);
    const journeys: Journey[] = [];
    dataset.tracks.forEach((track, device) => {
      const vessel = dataset.names[device];
      let key = vesselIds.get(vessel);
      if (key == null) {
        key = vesselIds.size + 1;
        vesselIds.set(vessel, key);
      }
      const carry = emptyCarry();
      const samples = track.map((index) => ({
        timeMs: dataset.timeMs[index],
        lat: dataset.lat[index],
        lon: dataset.lon[index],
        speed: dataset.speed[index],
      }));
      const rows = ingest(carry, samples, locate, key).concat(finish(carry, locate, key));
      for (const journey of rows) {
        if (!journey.credible) continue;
        credible += 1;
        const id = `inferred_activity:${journey.origin.areaId}\u0000${journey.destination.areaId}`;
        let byVessel = history.get(id);
        if (!byVessel) {
          byVessel = new Map();
          history.set(id, byVessel);
        }
        const list = byVessel.get(key);
        if (list) list.push(journey.durationMs);
        else byVessel.set(key, [journey.durationMs]);
      }
      journeys.push(...rows);
    });
    const review = findPassageOutliers(journeys, cohorts);
    flagged += review.outliers.length;
    for (const outlier of review.outliers) {
      const journey = journeys[outlier.journeyIndex];
      if (!journey) continue;
      found.push({
        day,
        outlier: { ...outlier, what: labelOf(journey) },
        pings: journey.pingsBetween,
        vesselKey: outlier.device,
      });
    }
    console.log(`day ${day} credible=${journeys.filter((journey) => journey.credible).length} flagged=${review.outliers.length}`);
  }

  for (const item of found) {
    const own = history.get(item.outlier.connectionId)?.get(item.vesselKey) ?? [];
    item.outlier.deviceMedianMs = own.length >= 3 ? quantile(own, 0.5) : null;
    item.outlier.pingsBetween = item.pings;
  }

  const tiers = { investigate: 0, data_issue: 0, insufficient: 0 };
  const byKind = new Map<string, number>();
  for (const item of found) {
    const tier = classifyOutlier(item.outlier).tier;
    tiers[tier] += 1;
    byKind.set(item.outlier.kind, (byKind.get(item.outlier.kind) ?? 0) + 1);
  }
  console.log(`days=${names.length} credible=${credible} flagged=${flagged} tiers=${JSON.stringify(tiers)} kinds=${JSON.stringify(Object.fromEntries(byKind))}`);

  const byDay = new Map<number, PassageOutlier[]>();
  for (const item of found) {
    const list = byDay.get(item.day);
    if (list) list.push(item.outlier);
    else byDay.set(item.day, [item.outlier]);
  }
  console.log("--- per loaded day ---");
  const dayCards: { day: number; z: number; line: string }[] = [];
  for (const [day, outliers] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const picks = reviewFirst(outliers, 3);
    const tiers = { investigate: 0, data_issue: 0, insufficient: 0 };
    for (const outlier of outliers) tiers[classifyOutlier(outlier).tier] += 1;
    console.log(`day ${day} flagged=${outliers.length} investigate=${tiers.investigate} data=${tiers.data_issue} insufficient=${tiers.insufficient} shown=${picks.length}`);
    picks.forEach((item, index) => {
      const line = [
        `#${index + 1}`,
        item.outlier.kind,
        item.outlier.what,
        `tookMin=${Math.round(item.outlier.durationMs / 60000)}`,
        `usualMin=${Math.round(item.outlier.cohortMedianMs / 60000)}`,
        `z=${item.outlier.robustZ.toFixed(1)}`,
        `path=${item.outlier.pathRatio.toFixed(2)}`,
        `gapMin=${Math.round(item.outlier.maxGapMs / 60000)}`,
        `named=${item.outlier.namedEnds}`,
      ].join(" | ");
      console.log(`  ${line}`);
      if (index === 0) dayCards.push({ day, z: item.outlier.robustZ, line });
    });
  }
  dayCards.sort((a, b) => b.z - a.z);
  console.log("--- strongest day cards ---");
  for (const card of dayCards.slice(0, 8)) console.log(`day=${card.day} | ${card.line}`);

  const ranked = reviewFirst(found.map((item) => item.outlier), 5);
  console.log("--- pooled review first ---");
  for (const item of ranked) {
    const source = found.find((row) => row.outlier === item.outlier);
    const own = item.outlier.deviceMedianMs == null ? "none" : String(Math.round(item.outlier.deviceMedianMs / 60000));
    console.log([
      `day=${source?.day ?? "?"}`,
      item.outlier.kind,
      item.tier,
      item.outlier.what,
      `tookMin=${Math.round(item.outlier.durationMs / 60000)}`,
      `usualMin=${Math.round(item.outlier.cohortMedianMs / 60000)}`,
      `ownMin=${own}`,
      `z=${item.outlier.robustZ.toFixed(1)}`,
      `gapMin=${Math.round(item.outlier.maxGapMs / 60000)}`,
      `path=${item.outlier.pathRatio.toFixed(2)}`,
      `kn=${item.outlier.trackedKn.toFixed(1)}`,
      `pings=${item.outlier.pingsBetween}`,
      `journeys=${item.outlier.cohortPassages}`,
      `vessels=${item.outlier.cohortVessels}`,
      item.notes[0] ?? "",
    ].join(" | "));
  }

  const investigate = found
    .map((item) => ({ ...item, review: classifyOutlier(item.outlier) }))
    .filter((item) => item.review.tier === "investigate")
    .sort((a, b) => b.outlier.robustZ - a.outlier.robustZ);
  console.log(`--- investigate sample ${Math.min(12, investigate.length)} of ${investigate.length} ---`);
  for (const item of investigate.slice(0, 12)) {
    console.log([
      `day=${item.day}`,
      item.outlier.kind,
      item.outlier.what,
      `tookMin=${Math.round(item.outlier.durationMs / 60000)}`,
      `usualMin=${Math.round(item.outlier.cohortMedianMs / 60000)}`,
      `z=${item.outlier.robustZ.toFixed(1)}`,
      `gapMin=${Math.round(item.outlier.maxGapMs / 60000)}`,
      `path=${item.outlier.pathRatio.toFixed(2)}`,
      `pings=${item.pings}`,
      `vessels=${item.outlier.cohortVessels}`,
    ].join(" | "));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
