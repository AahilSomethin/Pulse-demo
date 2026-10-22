"use client";

import { useEffect, useMemo, useState } from "react";

import { useMapOverlay } from "@/components/layout/useMapOverlay";
import { MetricCard, Notice } from "@/components/ui/Metrics";
import { CELL_OPTIONS, WINDOW_OPTIONS } from "@/config/constants";
import { useDataset, usePlaybackClock, usePlaybackSettings } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { loadCorpusQuality, type CorpusQuality } from "@/lib/analytics/corpus";
import { summarize } from "@/lib/analytics/overview";
import { formatCount, formatDuration, formatMvt, formatUtc, historicalLabel, maskDevice } from "@/lib/format";
import type { ExploreTab } from "@/lib/workspace/state";
import type { MapOverlay } from "@/types/map";
import type { HubMode } from "@/types/maritime";

const TABS: { id: ExploreTab; label: string }[] = [
  { id: "data", label: "Data" },
  { id: "vessels", label: "Vessels" },
  { id: "hubs", label: "Hubs" },
];

export function ExplorePanel() {
  const { state, setExploreTab } = useWorkspace();
  const overlay = useMemo<MapOverlay>(() => ({ clickMode: "vessel", markers: [], lines: [] }), []);
  useMapOverlay(overlay);

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Explore</h1>
        <p className="mt-1 text-sm leading-6 text-fg-secondary">One FollowMe day: dataset quality, vessel reports, and activity cells.</p>
      </header>
      <div role="tablist" aria-label="Explore" className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={state.exploreTab === tab.id} className={state.exploreTab === tab.id ? "btn btn-primary" : "btn"} onClick={() => setExploreTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      {state.exploreTab === "data" ? <DataTab /> : null}
      {state.exploreTab === "vessels" ? <VesselTab /> : null}
      {state.exploreTab === "hubs" ? <HubTab /> : null}
    </>
  );
}

function DataTab() {
  const { dataset, links, areaLinks, journeys, loading, error, loadCsvFile, loadCsvFiles, loadLocalAugust, loadGeoText, loadSample } = useDataset();
  const [corpus, setCorpus] = useState<CorpusQuality | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadCorpusQuality().then((value) => {
      if (!cancelled) setCorpus(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const stats = dataset ? summarize(dataset) : null;
  const credible = journeys.filter((journey) => !journey.coverageGap).length;

  return (
    <section data-tour="explore-data" className="flex flex-col gap-3">
      <details className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm leading-6">
        <summary className="cursor-pointer font-medium text-fg">Why SeaPulse?</summary>
        <div className="mt-2 space-y-2 text-fg-secondary">
          <p>Boat journeys connect communities across the Maldives, but a list of tracker points does not show which crossings repeat, how long they take, or which patterns deserve a closer look.</p>
          <p>SeaPulse reads historical GPS from tracked devices in August 2025 and rebuilds the crossings those devices actually made.</p>
          <p>For each observed connection it reports how often the journey appears, a typical travel time, how much those times vary, and whether the evidence is strong enough to compare.</p>
          <p>A planner can then ask where the record is thin and where better transport information would help. The file covers tracked devices, not every boat and not a published ferry timetable.</p>
        </div>
      </details>
      <label className="field">
        One day CSV
        <input type="file" accept=".csv,.txt" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void loadCsvFile(file);
        }} />
      </label>
      <label className="field">
        August folder
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) void loadCsvFiles(event.target.files);
          }}
          ref={(node) => {
            node?.setAttribute("webkitdirectory", "");
            node?.setAttribute("directory", "");
          }}
        />
      </label>
      <label className="field">
        Islands GeoJSON (optional)
        <input type="file" accept=".json,.geojson" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void file.text().then(loadGeoText);
        }} />
      </label>
      {process.env.NODE_ENV === "development" ? (
        <button type="button" className="btn btn-primary" onClick={() => void loadLocalAugust()} disabled={loading}>
          Load local August files
        </button>
      ) : null}
      <button type="button" className="btn" onClick={() => void loadSample()} disabled={loading}>
        Load synthetic test data
      </button>
      {error ? <Notice tone="warning">{error}</Notice> : null}
      {!dataset ? <Notice>Files stay in this browser. Counts describe devices in the file, not the Maldivian fleet.</Notice> : null}
      {dataset?.synthetic ? <Notice tone="warning">This file is synthetic test data, not a maritime finding.</Notice> : null}
      {dataset && !dataset.synthetic ? <Notice>{historicalLabel(dataset.periodLabel)}. Positions are past tracker reports.</Notice> : null}
      {dataset && stats ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Devices" value={formatCount(stats.devices)} detail={`${formatCount(stats.devicesWithMotion)} at or above 0.5`} />
            <MetricCard label="Pings kept" value={formatCount(stats.pings)} detail={`${formatCount(dataset.rejected.duplicate)} duplicates removed`} />
            <MetricCard label="Time span" value={formatDuration(stats.spanMs)} />
            <MetricCard label="Passages" value={formatCount(credible)} detail={`${formatCount(areaLinks.length)} area directions · ${formatCount(links.length)} named`} />
          </div>
          <p className="text-xs leading-5 text-fg-muted">
            {formatUtc(stats.t0)} to {formatUtc(stats.t1)}. Maldives clock starts at {formatMvt(stats.t0)}. The file is read as UTC.
            Median gap {dataset.quality.medianIntervalSec == null ? "—" : `${Math.round(dataset.quality.medianIntervalSec)} s`}.
            {" "}{formatCount(dataset.quality.implausibleJumps)} jumps imply more than 40.
            Median moving value {dataset.quality.medianMovingKn == null ? "—" : dataset.quality.medianMovingKn.toFixed(1)}. The unit is not in the file.
          </p>
        </>
      ) : null}
      {corpus?.status === "ready" ? (
        <section className="rounded-lg border border-border bg-surface-sunken p-3 text-xs leading-5 text-fg-secondary">
          <h2 className="text-sm font-semibold text-fg">Full August extract</h2>
          <p className="mt-1">
            {formatCount(corpus.fileCount ?? 0)} daily files, {formatCount(corpus.rowsKept ?? 0)} pings kept, {formatCount(corpus.devices ?? 0)} devices.
            The browser loads one day at a time. No device identifier or coordinate is stored in this summary.
          </p>
        </section>
      ) : null}
    </section>
  );
}

function VesselTab() {
  const { dataset } = useDataset();
  const playback = usePlaybackSettings();
  const { state, openDetail, focusOn, forgetDetail } = useWorkspace();
  const [draft, setDraft] = useState<string | null>(null);
  const selectedName = playback.selected >= 0 && dataset ? dataset.names[playback.selected] ?? "" : "";
  const query = draft ?? selectedName;

  function commitQuery(value: string) {
    if (!dataset) return;
    const trimmed = value.trim();
    const device = trimmed ? dataset.names.indexOf(trimmed) : -1;
    playback.setSelected(device);
    if (device >= 0) {
      openDetail({ type: "vessel", device });
      const indexes = dataset.tracks[device] ?? [];
      const last = indexes[indexes.length - 1];
      if (last != null) focusOn(dataset.lon[last], dataset.lat[last]);
    } else if (state.detail?.type === "vessel") {
      forgetDetail();
    }
  }

  return (
    <>
      <label className="field">
        Isolate device
        <input
          placeholder="Full device id"
          value={query}
          onFocus={() => setDraft(selectedName)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            commitQuery(draft ?? selectedName);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitQuery(draft ?? selectedName);
              setDraft(null);
            }
          }}
        />
      </label>
      <button
        type="button"
        className="btn"
        onClick={() => {
          playback.setSelected(-1);
          if (state.detail?.type === "vessel") forgetDetail();
        }}
      >
        Clear vessel
      </button>
      {dataset && playback.selected >= 0 ? (
        <p className="text-sm text-fg-secondary">
          Selected {maskDevice(dataset.names[playback.selected] ?? "")}. The details card holds the observation. Closing it keeps this vessel on the map.
        </p>
      ) : (
        <p className="text-sm text-fg-muted">Search for a full device id, or click a dot on the map.</p>
      )}
    </>
  );
}

function HubTab() {
  const playback = usePlaybackSettings();
  const { frame } = usePlaybackClock();
  const { openDetail, focusOn } = useWorkspace();

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className="field">
          Window
          <select value={playback.windowMs} onChange={(event) => playback.setWindowMs(Number(event.target.value))}>
            {WINDOW_OPTIONS.map((option) => (
              <option key={option.ms} value={option.ms}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Cell size
          <select value={playback.cellDeg} onChange={(event) => playback.setCellDeg(Number(event.target.value))}>
            {CELL_OPTIONS.map((option) => (
              <option key={option.deg} value={option.deg}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      <details className="rounded-lg border border-border px-3 py-2">
        <summary className="cursor-pointer text-sm text-fg-secondary">Advanced hub settings</summary>
        <div className="mt-2 grid grid-cols-1 gap-2">
          <label className="field">
            Hubs from
            <select value={playback.mode} onChange={(event) => playback.setMode(event.target.value as HubMode)}>
              <option value="stop">Stopped devices</option>
              <option value="move">Moving devices</option>
              <option value="all">All pings</option>
            </select>
          </label>
          <label className="field">
            Min peak speed
            <input type="number" min={0} step={1} value={playback.threshold} onChange={(event) => playback.setThreshold(Number(event.target.value) || 0)} />
          </label>
          <p className="text-xs leading-5 text-fg-muted">The speed filter keeps a device after 3 pings at or above this reported value. 0 turns it off. The unit is not in the file. This is not playback speed.</p>
        </div>
      </details>
      <section>
        <h2 className="text-sm font-semibold">Top hubs in window</h2>
        {frame && frame.topHubs.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {frame.topHubs.map((hub) => (
              <li key={`${hub.fx}:${hub.fy}`}>
                <button
                  type="button"
                  className="btn w-full justify-start font-normal"
                  onClick={() => {
                    openDetail({ type: "hub", fx: hub.fx, fy: hub.fy });
                    focusOn(hub.centerLon, hub.centerLat);
                  }}
                >
                  <span className="tabular-nums">{hub.centerLat.toFixed(3)}°, {hub.centerLon.toFixed(3)}° · {hub.devices} devices</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">Hubs appear after a CSV loads and the window contains activity.</p>
        )}
      </section>
    </>
  );
}
