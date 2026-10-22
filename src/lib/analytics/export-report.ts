import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import { passagesPerObservedDay } from "@/lib/analytics/connectivity";
import type { FrequencySummary } from "@/lib/analytics/frequency";

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function minutes(ms: number | null): string {
  if (ms == null) return "";
  return (ms / 60_000).toFixed(1);
}

const METHOD = [
  "Source: FollowMe tracker observations loaded in this browser. Not a live feed and not a ferry timetable.",
  "Method: dwell-to-dwell passages. Duration statistics pool credible journeys. Median, interquartile range, and 90th percentile use the type-7 quantile on that list.",
  "Evidence: adequate from 8 credible journeys and 3 vessels; limited from 3 journeys and 2 vessels. Vessel counts on a stored month include flagged passages because device ids are not stored.",
  "Same-island cell pairs are reclassified and are not exported as inter-island connections.",
  "The speed column has no documented unit and is not converted. The 40-knot gate is straight-line distance over time.",
  "Census population, when shown elsewhere, is geographic context. It is not transport demand.",
  "Coordinates, device identifiers, and raw trajectories are omitted. Connection-level geography from the private extract is not redistributed.",
  "A selected day range, when present, applies to passage counts only. Duration columns stay on the full window.",
];

/** Aggregate CSV. No coordinates, device ids, or trajectories. */
export function connectivityCsv(indicators: readonly ConnectionIndicator[], summary: FrequencySummary): string {
  const notes = ["# SeaPulse connectivity export", `# Period: ${summary.periodLabel}`, `# Scope: ${summary.scope}`, ...METHOD.map((line) => `# ${line}`)];
  const header = [
    "period",
    "origin",
    "origin_atoll",
    "origin_class",
    "destination",
    "destination_atoll",
    "destination_class",
    "passages",
    "passages_in_selected_days",
    "vessels",
    "credible_vessels",
    "active_days",
    "observation_days",
    "per_observed_day",
    "median_minutes",
    "iqr_minutes",
    "p90_minutes",
    "excluded",
    "evidence",
    "scope",
  ];
  const rows = indicators.map((indicator) => {
    const rate = passagesPerObservedDay(indicator);
    const inRange = summary.rangeIsFullWindow
      ? indicator.passages
      : indicator.dayCounts.slice(summary.dayFrom, summary.dayTo).reduce((sum, count) => sum + count, 0);
    return [
      indicator.periodLabel,
      indicator.origin.label,
      indicator.origin.atoll ?? "",
      indicator.origin.confidence,
      indicator.destination.label,
      indicator.destination.atoll ?? "",
      indicator.destination.confidence,
      indicator.passages,
      inRange,
      indicator.vessels,
      indicator.credibleVessels ?? "",
      indicator.activeDays,
      indicator.observationDays,
      rate == null ? "" : rate.toFixed(2),
      minutes(indicator.medianDurationMs),
      minutes(indicator.iqrMs),
      minutes(indicator.p90Ms),
      indicator.excluded,
      indicator.evidence,
      indicator.scope,
    ].map(csvCell).join(",");
  });
  return [...notes, header.join(","), ...rows].join("\n");
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
