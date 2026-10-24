"use client";

import { useMemo, useState } from "react";

import { TrackingQualityNote } from "@/components/network/TrackingQuality";
import { usePassageReview } from "@/components/network/usePassageReview";
import { Notice } from "@/components/ui/Metrics";
import { ANOMALY } from "@/config/constants";
import { useDataset } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { tallyPassageFlags } from "@/lib/analytics/anomalies";
import { countReviewTiers, reviewFirst } from "@/lib/analytics/review-priority";
import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import { connectivityCsv, downloadText } from "@/lib/analytics/export-report";
import { summarizeFrequency } from "@/lib/analytics/frequency";
import { formatCount, formatDuration } from "@/lib/format";

export function FrequencyReport({ indicators }: { indicators: readonly ConnectionIndicator[] }) {
  const { dataset, journeys, month, sameIslandPassages, monthSameIslandPassages } = useDataset();
  const { state } = useWorkspace();
  const review = usePassageReview();
  const unusual = useMemo(() => tallyPassageFlags(review.summaries.values()), [review.summaries]);
  const tiers = useMemo(
    () => (state.network.scope === "day" ? countReviewTiers(review.day.outliers) : null),
    [review.day.outliers, state.network.scope],
  );
  const reviewCards = useMemo(
    () => (state.network.scope === "day" ? reviewFirst(review.day.outliers, 3).length : null),
    [review.day.outliers, state.network.scope],
  );
  const sample = indicators[0];
  const days = Math.max(1, sample?.observationDays ?? 1);
  const period = `${sample?.periodLabel ?? "none"}:${days}`;
  const [range, setRange] = useState({ period, from: 1, to: days });
  const current = range.period === period ? range : { period, from: 1, to: days };
  const dayFrom = Math.min(current.from, days);
  const dayTo = Math.min(days, Math.max(current.to, dayFrom));
  const placeId = state.detail?.type === "location" ? state.detail.id : null;
  const summary = useMemo(() => summarizeFrequency({
    indicators,
    journeys: state.network.scope === "day" ? journeys : null,
    sameIslandPassages: state.network.scope === "month" ? monthSameIslandPassages : sameIslandPassages,
    dayFrom: dayFrom - 1,
    dayTo,
    placeId,
  }), [indicators, journeys, state.network.scope, monthSameIslandPassages, sameIslandPassages, dayFrom, dayTo, placeId]);

  function exportCsv() {
    downloadText("seapulse-connectivity.csv", connectivityCsv(indicators, summary, review.summaries));
  }

  return (
    <article className="print-sheet space-y-3" data-tour="network-report">
      <header>
        <h2 className="text-sm font-semibold">Vessel frequency</h2>
        <p className="mt-1 text-sm leading-6 text-fg-secondary">{summary.trackerNote}</p>
      </header>
      <dl className="space-y-1 text-sm">
        <Row label="Period" value={summary.periodLabel} />
        <Row label="Observed passages" value={formatCount(summary.passagesInRange)} hint="Credible dwell-to-dwell passages in the selected days. GPS pings are not visits." />
        <Row label="Connections" value={formatCount(summary.connections)} />
        <Row label="Distinct tracked vessels" value={summary.distinctVessels == null ? "Not available" : formatCount(summary.distinctVessels)} />
        <Row label="Active observation days" value={`${summary.activeDays} of ${summary.dayTo - summary.dayFrom}`} />
        <Row label="Coverage gaps excluded" value={formatCount(summary.excluded)} />
        <Row label="Same-island passages" value={formatCount(summary.sameIslandPassages)} hint="Different activity cells on one named island. They are not inter-island connections." />
        {summary.arrivals != null ? <Row label="Arrivals at the open place" value={formatCount(summary.arrivals)} /> : null}
        {summary.departures != null ? <Row label="Departures from the open place" value={formatCount(summary.departures)} /> : null}
        <Row label="Typical time" value={summary.medianDurationMs == null ? "—" : formatDuration(summary.medianDurationMs)} hint="Full window" />
        <Row label="Middle half of times" value={summary.iqrMs == null ? "Needs more journeys" : formatDuration(summary.iqrMs)} />
        <Row label="Longer journeys" value={summary.p90Ms == null ? "Needs more journeys" : formatDuration(summary.p90Ms)} />
      </dl>
      <p className="text-xs leading-5 text-fg-muted">{summary.distinctVesselNote}</p>
      <p className="text-xs leading-5 text-fg-muted">{summary.durationNote}</p>
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Unusual journey times</h3>
        <p className="text-sm leading-6 text-fg-secondary">
          {unusual.connections === 0
            ? "No connection in this window had two or more journeys far outside the usual time."
            : `${formatCount(unusual.connections)} ${unusual.connections === 1 ? "connection has" : "connections have"} journeys far outside the usual time: ${formatCount(unusual.outliers)} ${unusual.outliers === 1 ? "journey" : "journeys"} in total.`}
          {unusual.movementKnown && unusual.outliers > 0
            ? ` ${formatCount(unusual.stationary)} barely moved, ${formatCount(unusual.slowDirect)} ${unusual.slowDirect === 1 ? "was" : "were"} direct but slow, ${formatCount(unusual.longDetour)} took a much longer path, and ${formatCount(unusual.unusuallyLong)} ${unusual.unusuallyLong === 1 ? "was" : "were"} long without one of those patterns.`
            : ""}
          {tiers && reviewCards != null
            ? ` Review first shows ${formatCount(reviewCards)} ${reviewCards === 1 ? "connection" : "connections"}. ${formatCount(tiers.data_issue)} ${tiers.data_issue === 1 ? "journey looks" : "journeys look"} like a stop or a gap in the track, and ${formatCount(tiers.insufficient)} ${tiers.insufficient === 1 ? "matches" : "match"} that vessel’s own usual time.`
            : ""}
        </p>
        <p className="text-xs leading-5 text-fg-muted">
          A journey is flagged when its connection has at least {ANOMALY.minPassages} journeys and {ANOMALY.minVessels} vessels, the spread is above zero, the robust score is above {ANOMALY.robustZ}, and the time is above the third quartile plus {ANOMALY.iqrFence} times the middle half. One long journey in an otherwise identical set is not flagged. {state.network.scope === "month" ? "The August summary counts times only. Load a day to see whether a vessel was stopped or moving, and to replay it." : month ? "Open a flagged connection to replay one journey. The comparison uses the August summary." : "This day is compared with itself until the August summary is loaded. Switch the window to August, then return here to replay a journey against the month."} These counts are leads. They are not confirmed delays or incidents.
        </p>
      </section>
      {dataset ? <TrackingQualityNote dataset={dataset} /> : <p className="text-xs leading-5 text-fg-muted">Load a day to separate fast recorded movement from possible GPS jumps.</p>}
      <p className="text-xs leading-5 text-fg-muted">The recorded speed has no documented unit and is not converted. A stop under 0.5 uses that recorded number. The 40-knot check is straight-line distance over time.</p>
      {days > 1 ? (
        <div className="no-print flex flex-wrap gap-2">
          <label className="field">
            From day
            <input type="number" min={1} max={days} value={dayFrom} onChange={(event) => setRange({ period, from: Math.max(1, Math.min(days, Number(event.target.value) || 1)), to: dayTo })} />
          </label>
          <label className="field">
            To day
            <input type="number" min={1} max={days} value={dayTo} onChange={(event) => setRange({ period, from: dayFrom, to: Math.max(1, Math.min(days, Number(event.target.value) || days)) })} />
          </label>
        </div>
      ) : <p className="text-xs text-fg-muted">This window is one loaded day, so a custom date range is not available. Passage counts are for that day.</p>}
      {!summary.rangeIsFullWindow ? <Notice>The day range changes passage counts. Typical time, the middle half, and longer journeys stay on the full window.</Notice> : null}
      <div className="space-y-1">
        {summary.passagesByDay.map((count, index) => {
          const inRange = index >= summary.dayFrom && index < summary.dayTo;
          const width = summary.passagesInRange > 0 ? Math.min(100, (count / Math.max(...summary.passagesByDay, 1)) * 100) : 0;
          return (
            <div key={index} className={`grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2 text-xs ${inRange ? "" : "opacity-40"}`}>
              <span className="text-fg-muted">Day {index + 1}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
              </span>
              <span className="tabular-nums text-fg-secondary">{formatCount(count)}</span>
            </div>
          );
        })}
      </div>
      <div className="no-print flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={exportCsv}>Export CSV</button>
        <button type="button" className="btn" onClick={() => window.print()}>Print report</button>
      </div>
      <p className="text-xs leading-5 text-fg-muted">The CSV and the printed view include period, method, evidence rules, and limitations. They omit coordinates, device identifiers, and trajectories.</p>
    </article>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted" title={hint}>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
