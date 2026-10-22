import { readFile } from "node:fs/promises";

import { indicatorsFromMonth, parseStoredMonth } from "../src/lib/analytics/month";
import { findOpportunities } from "../src/lib/analytics/opportunities";
import { durationVariability } from "../src/lib/analytics/connectivity";

async function main() {
const file = parseStoredMonth(JSON.parse(await readFile("data/derived/connectivity-august-2025.json", "utf8")));
const indicators = indicatorsFromMonth(file);
const { flagged, withheld } = findOpportunities(indicators);
const named = indicators.filter((item) => item.origin.confidence !== "inferred" || item.destination.confidence !== "inferred").length;
console.log(`connections=${indicators.length} flagged=${flagged.length} withheld=${withheld.length} namedEnds=${named}`);
console.log("--- busiest ---");
for (const item of indicators.slice(0, 5)) {
  const rate = item.passages / item.observationDays;
  console.log([
    item.origin.label,
    "->",
    item.destination.label,
    `journeys=${item.passages}`,
    `vessels=${item.vessels}`,
    `perDay=${rate.toFixed(1)}`,
    `medianMin=${item.medianDurationMs == null ? "" : Math.round(item.medianDurationMs / 60000)}`,
    `iqrMin=${item.iqrMs == null ? "" : Math.round(item.iqrMs / 60000)}`,
    `p90Min=${item.p90Ms == null ? "" : Math.round(item.p90Ms / 60000)}`,
    `path=${item.medianPathRatio?.toFixed(2) ?? ""}`,
    `km=${item.medianDistanceM == null ? "" : (item.medianDistanceM / 1000).toFixed(1)}`,
    `excluded=${item.excluded}`,
    item.evidence,
    item.origin.confidence,
    item.destination.confidence,
  ].join(" | "));
}
console.log("--- flagged ---");
for (const item of flagged.slice(0, 8)) {
  const indicator = item.indicator;
  console.log([
    item.rules.map((rule) => rule.id).join(","),
    indicator.origin.label,
    "->",
    indicator.destination.label,
    `journeys=${indicator.passages}`,
    `vessels=${indicator.vessels}`,
    `medianMin=${indicator.medianDurationMs == null ? "" : Math.round(indicator.medianDurationMs / 60000)}`,
    `p90Min=${indicator.p90Ms == null ? "" : Math.round(indicator.p90Ms / 60000)}`,
    `variability=${durationVariability(indicator)?.toFixed(2) ?? ""}`,
    `path=${indicator.medianPathRatio?.toFixed(2) ?? ""}`,
    `km=${indicator.medianDistanceM == null ? "" : (indicator.medianDistanceM / 1000).toFixed(1)}`,
    `excluded=${indicator.excluded}`,
    `activeDays=${indicator.activeDays}`,
  ].join(" | "));
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
