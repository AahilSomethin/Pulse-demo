"use client";

import { useState } from "react";

import { usePlaybackClock, usePlaybackSettings } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import type { PassageFlagSummary, PassageOutlier } from "@/lib/analytics/anomalies";
import { classifyOutlier, findingTitle } from "@/lib/analytics/review-priority";
import { formatCount, formatDuration } from "@/lib/format";
import type { Journey } from "@/types/maritime";

const TIER_LABEL = {
  investigate: "Worth investigating",
  data_issue: "Possible data issue",
  insufficient: "Not enough to promote",
} as const;

export function UnusualPassages({
  outliers,
  journeys,
  monthSummary,
  device,
}: {
  outliers: readonly PassageOutlier[];
  journeys: readonly Journey[];
  monthSummary?: PassageFlagSummary;
  device?: number;
}) {
  const rows = outliers.filter((item) => device == null || item.device === device);
  const shown = rows.slice(0, device == null ? 6 : 3);
  const [opened, setOpened] = useState<number | null>(null);
  const current = shown.find((item) => item.journeyIndex === opened) ?? shown[0] ?? null;
  if (rows.length === 0 && !(monthSummary && monthSummary.outliers > 0)) return null;

  return (
    <section className="mt-3 space-y-2">
      <h3 className="text-sm font-semibold">Unusual journeys</h3>
      {monthSummary && monthSummary.outliers > 0 ? (
        <p className="text-xs leading-5 text-fg-muted">
          The August summary has {formatCount(monthSummary.outliers)} journeys far longer than usual
          {monthSummary.movementKnown ? "" : ", counted from times only"}. Replay is available for journeys in the loaded day.
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="text-xs leading-5 text-fg-muted">No journey in the loaded day was far outside the usual time{device == null ? " for this connection" : " for this device"}.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {shown.map((item) => (
              <button
                key={item.journeyIndex}
                type="button"
                className={`btn w-full justify-start text-left ${current?.journeyIndex === item.journeyIndex ? "border-primary bg-primary-soft text-primary" : ""}`}
                aria-pressed={current?.journeyIndex === item.journeyIndex}
                onClick={() => setOpened(item.journeyIndex)}
              >
                {findingTitle(item.kind)} · {formatDuration(item.durationMs)}
              </button>
            ))}
          </div>
          {rows.length > shown.length ? (
            <p className="text-xs text-fg-muted">{formatCount(rows.length - shown.length)} more unusual journeys are not listed here.</p>
          ) : null}
          {current ? <PassageStory item={current} journey={journeys[current.journeyIndex] ?? null} /> : null}
        </>
      )}
    </section>
  );
}

function PassageStory({ item, journey }: { item: PassageOutlier; journey: Journey | null }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-sunken p-2 text-sm leading-6">
      <p className="text-xs text-fg-muted">{TIER_LABEL[classifyOutlier(item).tier]}</p>
      <p><span className="font-medium">What happened. </span>{item.what}</p>
      <p><span className="font-medium">Why it was flagged. </span>{item.why}</p>
      <p><span className="font-medium">Evidence. </span>{item.evidence}</p>
      <p><span className="font-medium">What to investigate. </span>{item.investigate}</p>
      {journey ? <ReplayButton journey={journey} /> : <p className="text-xs text-fg-muted">This journey is not in the loaded day, so it cannot be replayed.</p>}
    </div>
  );
}

function ReplayButton({ journey }: { journey: Journey }) {
  const { setCursor } = usePlaybackClock();
  const { setPlaying, setSelected } = usePlaybackSettings();
  const { focusOn } = useWorkspace();
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        setPlaying(false);
        setSelected(journey.device);
        setCursor(journey.origin.endMs);
        focusOn(journey.origin.lon, journey.origin.lat, { zoom: 11 });
      }}
    >
      Replay on the map
    </button>
  );
}
