"use client";

import { usePlaybackClock, usePlaybackSettings } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import type { PassageOutlier } from "@/lib/analytics/anomalies";
import { findingTitle, plainWhy, type RankedFinding } from "@/lib/analytics/review-priority";
import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import { formatCount, formatDuration } from "@/lib/format";
import type { Journey } from "@/types/maritime";

export function ReviewFirst({
  findings,
  dataIssues,
  insufficient,
  hiddenByFilter,
  journeys,
  indicatorFor,
  onChoose,
}: {
  findings: readonly RankedFinding[];
  dataIssues: number;
  insufficient: number;
  hiddenByFilter?: boolean;
  journeys: readonly Journey[];
  indicatorFor: (id: string) => ConnectionIndicator | null;
  onChoose: (indicator: ConnectionIndicator) => void;
}) {
  return (
    <section className="space-y-2" data-tour="review-first">
      <h2 className="text-sm font-semibold">Review first</h2>
      <p className="text-sm leading-6 text-fg-secondary">
        The clearest unusual journeys in this loaded day. Each one is a lead for replay, not a confirmed delay or a dangerous event.
      </p>
      {findings.length === 0 ? (
        <p className="text-sm leading-6 text-fg-muted">
          {hiddenByFilter
            ? "The place filters are hiding every unusual journey. Clear the atoll or place type to see the review, or open all findings."
            : dataIssues > 0
            ? `${formatCount(dataIssues)} ${dataIssues === 1 ? "journey was" : "journeys were"} far outside the usual time, but the track looks like a stop or a gap in the reports. ${insufficient > 0 ? `${formatCount(insufficient)} more match that vessel’s own usual time. ` : ""}None are promoted as movement to investigate.`
            : "No journey in this day is both far outside the usual time and clear of tracking problems. A comparison needs at least 8 journeys from 3 vessels, a real spread in those times, and a trip beyond both checks."}
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((finding) => {
            const indicator = indicatorFor(finding.outlier.connectionId);
            const journey = journeys[finding.outlier.journeyIndex] ?? null;
            return (
              <li key={`${finding.outlier.connectionId}:${finding.outlier.journeyIndex}`}>
                <ReviewCard finding={finding} indicator={indicator} journey={journey} onChoose={onChoose} />
              </li>
            );
          })}
        </ul>
      )}
      {findings.length > 0 && (dataIssues > 0 || insufficient > 0) ? (
        <p className="text-xs leading-5 text-fg-muted">
          {dataIssues > 0 ? `${formatCount(dataIssues)} other ${dataIssues === 1 ? "journey looks" : "journeys look"} like a stop or a gap in the track. ` : ""}
          {insufficient > 0 ? `${formatCount(insufficient)} ${insufficient === 1 ? "matches" : "match"} that vessel’s own usual time. ` : ""}
          Those are not listed here.
        </p>
      ) : null}
    </section>
  );
}

function placeName(label: string): string | null {
  const named = label.split(" · ")[0]?.trim();
  if (!named || named.startsWith("Inferred area")) return null;
  return named;
}

function routeLabel(indicator: ConnectionIndicator): string {
  const from = placeName(indicator.origin.label);
  const to = placeName(indicator.destination.label);
  if (from && to) return `${from} to ${to}`;
  if (from) return `${from} to an activity area`;
  if (to) return `An activity area to ${to}`;
  return "Between two activity areas";
}

function ReviewCard({
  finding,
  indicator,
  journey,
  onChoose,
}: {
  finding: RankedFinding;
  indicator: ConnectionIndicator | null;
  journey: Journey | null;
  onChoose: (indicator: ConnectionIndicator) => void;
}) {
  const item = finding.outlier;
  const route = indicator ? routeLabel(indicator) : placeLine(item);
  return (
    <article className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <h3 className="text-sm font-semibold">{findingTitle(item.kind)}</h3>
      <p className="text-sm text-fg-secondary">{route}</p>
      <p className="text-sm leading-6">
        Took {formatDuration(item.durationMs)}. Usual journeys take {formatDuration(item.cohortMedianMs)}.
      </p>
      <p className="text-sm leading-6 text-fg-secondary">{plainWhy(item)}</p>
      {item.maxGapMs >= 10 * 60_000 ? (
        <p className="text-xs leading-5 text-fg-muted">The longest gap between reports was {formatDuration(item.maxGapMs)}.</p>
      ) : null}
      <p className="text-xs leading-5 text-fg-muted">
        Compared with {formatCount(item.cohortPassages)} journeys from {formatCount(item.cohortVessels)} vessels.
        {item.deviceMedianMs == null ? " This vessel has fewer than 3 journeys here, so it is not compared with itself." : ` This vessel’s own journeys here usually take ${formatDuration(item.deviceMedianMs)}.`}
      </p>
      {journey ? (
        <InvestigateButton
          journey={journey}
          onOpen={indicator ? () => onChoose(indicator) : undefined}
        />
      ) : (
        <p className="text-xs text-fg-muted">This journey is not in the loaded day, so it cannot be replayed.</p>
      )}
    </article>
  );
}

function placeLine(item: PassageOutlier): string {
  const match = item.what.match(/from (.+) to (.+) took/);
  if (match) return `${match[1]} to ${match[2]}`;
  return "Between two activity areas";
}

function InvestigateButton({ journey, onOpen }: { journey: Journey; onOpen?: () => void }) {
  const { setCursor } = usePlaybackClock();
  const { setPlaying, setSelected } = usePlaybackSettings();
  const { focusOn } = useWorkspace();
  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => {
        onOpen?.();
        setPlaying(false);
        setSelected(journey.device);
        setCursor(journey.origin.endMs);
        focusOn(journey.origin.lon, journey.origin.lat, { zoom: 11 });
      }}
    >
      Investigate
    </button>
  );
}
