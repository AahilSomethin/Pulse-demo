"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useState } from "react";

import { WINDOW_OPTIONS } from "@/config/constants";
import { useDataset, usePlaybackClock, usePlaybackSettings } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { formatMvt, formatUtc } from "@/lib/format";
import { PLAYBACK_SPEED_LABEL, PLAYBACK_SPEEDS } from "@/lib/vessels/playback";

export function PlaybackBar() {
  const { dataset, days, activeDay, selectDay, loading } = useDataset();
  const { cursor, setCursor, frame } = usePlaybackClock();
  const { playing, setPlaying, speed, setSpeed, restart, windowMs } = usePlaybackSettings();
  const { state, setClock } = useWorkspace();
  const [more, setMore] = useState(false);
  if (!dataset) return null;

  const span = Math.max(dataset.t1 - dataset.t0, 1);
  const dayIndex = activeDay ? days.indexOf(activeDay) : -1;
  const primary = state.clock === "mvt" ? formatMvt(cursor) : formatUtc(cursor);
  const secondary = state.clock === "mvt" ? formatUtc(cursor) : formatMvt(cursor);
  const windowLabel = WINDOW_OPTIONS.find((option) => option.ms === windowMs)?.label ?? `${Math.round(windowMs / 60_000)} min`;
  const bandStart = Math.max(dataset.t0, cursor - windowMs);
  const bandEnd = Math.min(dataset.t1, Math.max(cursor, dataset.t0));
  const bandLeft = ((bandStart - dataset.t0) / span) * 100;
  const bandWidth = Math.max(((bandEnd - bandStart) / span) * 100, 0.5);

  const dayControls = (
    <div className="flex items-center gap-1">
      <button type="button" className="btn" disabled={loading || dayIndex <= 0} onClick={() => void selectDay(days[dayIndex - 1])}>
        Previous day
      </button>
      <label className="sr-only" htmlFor="day-select">Tracker day</label>
      <select
        id="day-select"
        className="min-h-9 max-w-36 rounded-md border border-border bg-surface-sunken px-2 text-sm"
        value={activeDay ?? ""}
        disabled={loading || days.length === 0}
        onChange={(event) => void selectDay(event.target.value)}
      >
        {days.map((day) => (
          <option key={day} value={day}>{day}</option>
        ))}
      </select>
      <button type="button" className="btn" disabled={loading || dayIndex < 0 || dayIndex >= days.length - 1} onClick={() => void selectDay(days[dayIndex + 1])}>
        Next day
      </button>
    </div>
  );

  const speedControl = (
    <label className="field min-w-36">
      Playback speed
      <select
        value={speed}
        aria-describedby="playback-speed-note"
        onChange={(event) => setSpeed(Number(event.target.value))}
      >
        {PLAYBACK_SPEEDS.map((item) => (
          <option key={item} value={item}>{item}× {PLAYBACK_SPEED_LABEL[item]}</option>
        ))}
      </select>
    </label>
  );

  return (
    <footer className="z-30 shrink-0 border-t border-border bg-surface">
      {speed > 1 ? (
        <p id="playback-speed-note" className="px-3 pt-2 text-xs leading-5 text-fg-muted">
          Sampled playback. The historical clock jumps between moments, so GPS reports between samples are not drawn. Playback speed is not a vessel’s reported speed.
        </p>
      ) : (
        <p id="playback-speed-note" className="sr-only">
          Playback speed moves the historical clock. It does not change a vessel’s reported speed.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" className="btn" onClick={() => setPlaying(!playing)} aria-pressed={playing} aria-keyshortcuts="Space" disabled={loading}>
          {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="btn" onClick={restart} disabled={loading}>
          <RotateCcw size={16} aria-hidden />
          Restart
        </button>
        <div className="hidden md:block">{dayControls}</div>
        <div className="min-w-40 flex-1">
          <div className="relative mb-1 h-1 rounded-full bg-surface-sunken" title={`Observation window ${windowLabel}`}>
            <div className="absolute h-full rounded-full bg-ocean" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />
          </div>
          <input
            className="w-full accent-primary"
            type="range"
            min={dataset.t0}
            max={dataset.t1}
            step={1000}
            value={Math.min(Math.max(cursor, dataset.t0), dataset.t1)}
            aria-label="Timeline"
            aria-valuetext={`${primary}. Window ${windowLabel}.`}
            onChange={(event) => {
              setPlaying(false);
              setCursor(Number(event.target.value));
            }}
          />
        </div>
        <div className="min-w-0 text-xs tabular-nums">
          <p>{primary}</p>
          <p className="hidden text-fg-muted md:block" title={state.clock === "mvt" ? "UTC" : "Maldives time, UTC+5"}>{secondary}</p>
        </div>
        <button
          type="button"
          className="btn"
          aria-pressed={state.clock === "mvt"}
          onClick={() => setClock(state.clock === "utc" ? "mvt" : "utc")}
        >
          {state.clock === "utc" ? "UTC" : "MVT"}
        </button>
        <div className="hidden lg:block">{speedControl}</div>
        <p className="hidden text-xs text-fg-muted xl:block">
          {frame ? `${frame.pingCount} ${frame.pingCount === 1 ? "ping" : "pings"}, ${frame.positions.length} ${frame.positions.length === 1 ? "device" : "devices"}` : "—"}
          <span className="sr-only"> Window {windowLabel}.</span>
        </p>
        <div className="lg:hidden">
          <button type="button" className="btn" aria-expanded={more} onClick={() => setMore((current) => !current)}>
            {more ? "Less" : "More"}
          </button>
        </div>
      </div>
      {more ? (
        <div className="flex flex-col gap-2 border-t border-border-soft px-3 py-2 lg:hidden">
          {dayControls}
          {speedControl}
          <p className="text-xs text-fg-muted">{secondary}. {state.clock === "utc" ? "Secondary time is Maldives (UTC+5)." : "Secondary time is UTC."}</p>
        </div>
      ) : null}
    </footer>
  );
}
