import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import { dwellsSameIsland } from "@/lib/analytics/same-island";
import { quantile, quartileRange } from "@/lib/analytics/stats";
import { CONNECTIVITY } from "@/config/constants";
import type { Journey } from "@/types/maritime";

export interface FrequencySummary {
  periodLabel: string;
  scope: ConnectionIndicator["scope"] | "none";
  observationDays: number;
  dayFrom: number;
  dayTo: number;
  rangeIsFullWindow: boolean;
  passagesByDay: number[];
  passagesInRange: number;
  connections: number;
  distinctVessels: number | null;
  distinctVesselNote: string;
  activeDays: number;
  excluded: number;
  sameIslandPassages: number;
  arrivals: number | null;
  departures: number | null;
  medianDurationMs: number | null;
  iqrMs: number | null;
  p90Ms: number | null;
  durationNote: string;
  trackerNote: string;
}

function sumRange(counts: readonly number[], from: number, to: number): number {
  let total = 0;
  for (let index = from; index < to && index < counts.length; index += 1) total += counts[index] ?? 0;
  return total;
}

export function summarizeFrequency(input: {
  indicators: readonly ConnectionIndicator[];
  journeys?: readonly Journey[] | null;
  sameIslandPassages?: number;
  dayFrom?: number;
  dayTo?: number;
  placeId?: string | null;
}): FrequencySummary {
  const indicators = input.indicators;
  const sample = indicators[0];
  const observationDays = Math.max(1, sample?.observationDays ?? 1);
  const dayFrom = Math.max(0, Math.min(input.dayFrom ?? 0, observationDays - 1));
  const dayTo = Math.max(dayFrom + 1, Math.min(input.dayTo ?? observationDays, observationDays));
  const rangeIsFullWindow = dayFrom === 0 && dayTo === observationDays;
  const passagesByDay = Array.from({ length: observationDays }, (_, index) => (
    indicators.reduce((sum, indicator) => sum + (indicator.dayCounts[index] ?? 0), 0)
  ));
  const passagesInRange = sumRange(passagesByDay, dayFrom, dayTo);
  const activeDays = passagesByDay.slice(dayFrom, dayTo).filter((count) => count > 0).length;
  const excluded = indicators.reduce((sum, indicator) => sum + indicator.excluded, 0);
  const durations = indicators.flatMap((indicator) => indicator.durationsMs);
  const keys = new Set(indicators.map((indicator) => `${indicator.origin.id}\u0000${indicator.destination.id}`));
  let distinctVessels: number | null = null;
  let distinctVesselNote = "The August summary stores a vessel count on each connection and does not store device ids, so vessels cannot be de-duplicated across connections.";
  if (input.journeys) {
    const devices = new Set<number>();
    for (const journey of input.journeys) {
      if (!journey.credible || dwellsSameIsland(journey.origin, journey.destination)) continue;
      if (journey.origin.areaId === journey.destination.areaId) continue;
      if (!keys.has(`${journey.origin.areaId}\u0000${journey.destination.areaId}`)) continue;
      devices.add(journey.device);
    }
    distinctVessels = devices.size;
    distinctVesselNote = "Distinct devices with at least one credible passage on the connections in this filter. Repeated GPS pings inside a stop are not extra vessels.";
  }
  let arrivals: number | null = null;
  let departures: number | null = null;
  if (input.placeId) {
    arrivals = 0;
    departures = 0;
    for (const indicator of indicators) {
      const passages = rangeIsFullWindow ? indicator.passages : sumRange(indicator.dayCounts, dayFrom, dayTo);
      if (indicator.destination.id === input.placeId || indicator.destination.sourceId === input.placeId) arrivals += passages;
      if (indicator.origin.id === input.placeId || indicator.origin.sourceId === input.placeId) departures += passages;
    }
  }
  return {
    periodLabel: sample?.periodLabel ?? "No observation window",
    scope: sample?.scope ?? "none",
    observationDays,
    dayFrom,
    dayTo,
    rangeIsFullWindow,
    passagesByDay,
    passagesInRange,
    connections: indicators.length,
    distinctVessels,
    distinctVesselNote,
    activeDays,
    excluded,
    sameIslandPassages: input.sameIslandPassages ?? 0,
    arrivals,
    departures,
    medianDurationMs: quantile(durations, 0.5),
    iqrMs: quartileRange(durations, CONNECTIVITY.minPassagesForIqr),
    p90Ms: durations.length >= CONNECTIVITY.minPassagesForP90 ? quantile(durations, 0.9) : null,
    durationNote: "Median, middle half, and longer journeys use every credible duration in the full window. A shorter day range changes passage counts only. It does not recalculate those times.",
    trackerNote: "These are observed movements of tracked devices. They are not a scheduled passenger ferry frequency, and a GPS ping is not a vessel visit.",
  };
}
