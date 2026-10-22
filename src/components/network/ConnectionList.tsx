"use client";

import { CONNECTIVITY } from "@/config/constants";
import { durationVariability, passagesPerObservedDay, type ConnectionIndicator } from "@/lib/analytics/connectivity";
import { atollOptions } from "@/lib/analytics/filters";
import { formatCount, formatDuration, formatKm } from "@/lib/format";
import type { NetworkFilters } from "@/lib/workspace/state";

const CONFIDENCE = {
  inferred: "Inferred cluster",
  named_polygon: "Named place",
  near_harbour: "Near a harbour",
} as const;

export function confidenceLabel(indicator: ConnectionIndicator): string {
  const ends = [indicator.origin.confidence, indicator.destination.confidence];
  if (ends.every((item) => item === "inferred")) return "Both ends are inferred clusters";
  if (ends.includes("named_polygon")) return "At least one end matches a named place";
  return "At least one end is near a harbour point";
}

export function ConnectionFilters({
  filters,
  atolls,
  onChange,
}: {
  filters: NetworkFilters;
  atolls: string[];
  onChange: (patch: Partial<NetworkFilters>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="field">
        Observation window
        <select value={filters.scope} onChange={(event) => onChange({ scope: event.target.value === "month" ? "month" : "day" })}>
          <option value="day">Loaded day</option>
          <option value="month">August 2025 summary</option>
        </select>
      </label>
      <label className="field">
        Minimum journeys
        <input type="number" min={1} step={1} value={filters.minPassages} onChange={(event) => onChange({ minPassages: Math.max(1, Number(event.target.value) || 1) })} />
      </label>
      <label className="field">
        Shortest typical time (minutes, 0 for any)
        <input type="number" min={0} step={5} value={filters.minDurationMin} onChange={(event) => onChange({ minDurationMin: Math.max(0, Number(event.target.value) || 0) })} />
      </label>
      <label className="field">
        Longest typical time (minutes, 0 for any)
        <input type="number" min={0} step={5} value={filters.maxDurationMin} onChange={(event) => onChange({ maxDurationMin: Math.max(0, Number(event.target.value) || 0) })} />
      </label>
      <label className="field">
        Place type
        <select value={filters.geoClass} onChange={(event) => onChange({ geoClass: event.target.value as NetworkFilters["geoClass"] })}>
          <option value="all">All</option>
          <option value="inferred">Inferred clusters</option>
          <option value="named">Named places</option>
          <option value="harbour">Near a harbour</option>
        </select>
      </label>
      <label className="field">
        Evidence
        <select value={filters.evidence} onChange={(event) => onChange({ evidence: event.target.value as NetworkFilters["evidence"] })}>
          <option value="all">All</option>
          <option value="limited">Limited or better</option>
          <option value="adequate">Enough to compare</option>
        </select>
      </label>
      <label className="field">
        Minimum time variation
        <select value={String(filters.minVariability)} onChange={(event) => onChange({ minVariability: Number(event.target.value) })}>
          <option value="0">Any</option>
          <option value="0.5">Middle half is at least half the typical time</option>
          <option value="1">Middle half is at least the typical time</option>
        </select>
      </label>
      {atolls.length > 0 ? (
        <label className="field">
          Atoll
          <select value={filters.atoll} onChange={(event) => onChange({ atoll: event.target.value })}>
            <option value="">All</option>
            {atolls.map((atoll) => <option key={atoll} value={atoll}>{atoll}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function atollsFor(indicators: readonly ConnectionIndicator[]): string[] {
  return atollOptions(indicators);
}

export function ConnectionCard({
  indicator,
  active,
  onChoose,
}: {
  indicator: ConnectionIndicator;
  active: boolean;
  onChoose: (indicator: ConnectionIndicator) => void;
}) {
  const rate = passagesPerObservedDay(indicator);
  const variability = durationVariability(indicator);
  const stable = indicator.passages >= CONNECTIVITY.minPassagesForIqr;
  return (
    <button type="button" aria-pressed={active} className={`w-full rounded-lg border px-3 py-2 text-left text-sm leading-6 ${active ? "border-selected bg-selected-soft" : "border-border bg-surface"}`} onClick={() => onChoose(indicator)}>
      <p className="font-medium">{indicator.origin.label} → {indicator.destination.label}</p>
      <p className="text-fg-secondary">
        {formatCount(indicator.passages)} journeys · {formatCount(indicator.vessels)} vessels · {rate == null ? "—" : `${rate.toFixed(1)} per day`}
      </p>
      <p className="text-fg-secondary">
        Typical time {indicator.medianDurationMs == null ? "—" : formatDuration(indicator.medianDurationMs)}
        {stable && indicator.iqrMs != null ? ` · middle half ${formatDuration(indicator.iqrMs)}` : ""}
        {indicator.medianDistanceM == null ? "" : ` · ${formatKm(indicator.medianDistanceM)} apart`}
      </p>
      <p className="text-xs text-fg-muted">
        {confidenceLabel(indicator)} · {CONFIDENCE[indicator.origin.confidence]} to {CONFIDENCE[indicator.destination.confidence]}
        {variability != null && stable ? ` · variation ${Math.round(variability * 100)}%` : ""}
        {indicator.passages < CONNECTIVITY.minPassagesForIqr ? " · too few journeys for a stable spread" : ""}
      </p>
    </button>
  );
}
