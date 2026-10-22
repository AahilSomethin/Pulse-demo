import type { ConnectionIndicator, IndicatorScope } from "@/lib/analytics/connectivity";
import { quantile, quartileRange } from "@/lib/analytics/stats";
import { CONNECTIVITY } from "@/config/constants";
import { connectionId } from "@/lib/workspace/state";
import type { GeoConfidence } from "@/types/maritime";

export interface StoredConnection {
  originId: string;
  destinationId: string;
  originLabel: string;
  destinationLabel: string;
  originLat: number;
  originLon: number;
  destinationLat: number;
  destinationLon: number;
  originConfidence: GeoConfidence;
  destinationConfidence: GeoConfidence;
  originSourceId: string | null;
  destinationSourceId: string | null;
  originAtoll: string | null;
  destinationAtoll: string | null;
  vessels: number;
  dayCounts: number[];
  /** Credible durations in whole seconds. Percentiles are computed from this pooled list. */
  durationSec: number[];
  distanceM: number[];
  pathRatio: number[];
  excluded: number;
}

export interface StoredMonth {
  schema: 1;
  periodLabel: string;
  method: string;
  generatedAt: string;
  days: { day: string; rowsKept: number; devices: number }[];
  rowsKept: number;
  devices: number;
  minVessels: number;
  connections: StoredConnection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseStoredMonth(value: unknown): StoredMonth {
  if (!isRecord(value) || value.schema !== 1 || !Array.isArray(value.connections)) {
    throw new Error("The month summary is not a schema 1 connectivity file.");
  }
  return value as unknown as StoredMonth;
}

function evidenceFor(passages: number, vessels: number): ConnectionIndicator["evidence"] {
  if (passages >= CONNECTIVITY.minPassagesAdequate && vessels >= CONNECTIVITY.minVesselsAdequate) return "adequate";
  if (passages >= CONNECTIVITY.minPassagesLimited && vessels >= CONNECTIVITY.minVesselsLimited) return "limited";
  return "insufficient";
}

/** Rebuilds indicators from stored passage samples. Daily percentiles are not in the file. */
export function indicatorsFromMonth(file: StoredMonth, scope: IndicatorScope = "month"): ConnectionIndicator[] {
  return file.connections.map((connection) => {
    const durationsMs = connection.durationSec.map((seconds) => seconds * 1000);
    const passages = durationsMs.length;
    return {
      id: connectionId("inferred_activity", connection.originId, connection.destinationId),
      origin: {
        id: connection.originId,
        label: connection.originLabel,
        lat: connection.originLat,
        lon: connection.originLon,
        confidence: connection.originConfidence,
        sourceId: connection.originSourceId,
        atoll: connection.originAtoll,
      },
      destination: {
        id: connection.destinationId,
        label: connection.destinationLabel,
        lat: connection.destinationLat,
        lon: connection.destinationLon,
        confidence: connection.destinationConfidence,
        sourceId: connection.destinationSourceId,
        atoll: connection.destinationAtoll,
      },
      passages,
      vessels: connection.vessels,
      attempted: passages + connection.excluded,
      excluded: connection.excluded,
      activeDays: connection.dayCounts.filter((count) => count > 0).length,
      dayCounts: connection.dayCounts,
      durationsMs,
      medianDurationMs: quantile(durationsMs, 0.5),
      iqrMs: quartileRange(durationsMs, CONNECTIVITY.minPassagesForIqr),
      p90Ms: durationsMs.length >= CONNECTIVITY.minPassagesForP90 ? quantile(durationsMs, 0.9) : null,
      medianDistanceM: quantile(connection.distanceM, 0.5),
      medianPathRatio: quantile(connection.pathRatio, 0.5),
      evidence: evidenceFor(passages, connection.vessels),
      scope,
      periodLabel: file.periodLabel,
      observationDays: file.days.length,
    };
  }).sort((a, b) => b.passages - a.passages || a.id.localeCompare(b.id));
}
