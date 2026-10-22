"use client";

import { X } from "lucide-react";

import { CELL_OPTIONS, CONNECTIVITY, STOP_SPEED_KN, WINDOW_OPTIONS } from "@/config/constants";
import { useDataset, usePlaybackClock, usePlaybackSettings } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { formatCount, formatDuration, formatKm, formatMinutes, formatMvt, formatUtc, historicalLabel, maskDevice } from "@/lib/format";
import { durationVariability, passagesPerObservedDay, type ConnectionIndicator } from "@/lib/analytics/connectivity";
import { connectivityCsv, downloadText } from "@/lib/analytics/export-report";
import { summarizeFrequency } from "@/lib/analytics/frequency";
import { buildIslandProfile, buildLocationProfile } from "@/lib/analytics/profile";
import type { CensusMatchMethod } from "@/lib/analytics/population";
import { findLink } from "@/lib/workspace/connection";
import { trailIndexes } from "@/lib/vessels/frame";
import { compareResponses } from "@/lib/simulation/emergency";
import type { HubMode } from "@/types/maritime";

const MODE_LABEL: Record<HubMode, string> = {
  stop: "Stopped devices (recorded speed under 0.5, unit unverified)",
  move: "Moving devices",
  all: "All pings",
};

const EVIDENCE = {
  observed_position: "Historical observation",
  verified_coast_guard: "Verified Coast Guard site",
  unverified_coast_guard: "Unverified loaded site",
  hypothetical_coast_guard: "Hypothetical origin",
} as const;

export function DetailsDrawer() {
  const { state, closeDetail } = useWorkspace();
  if (!state.detailsOpen || !state.detail) return null;
  const tallSheet = state.sidebar === "expanded";

  return (
    <aside
      aria-label="Selection details"
      data-tour="details"
      className={`absolute top-3 right-3 z-20 flex w-[min(22rem,calc(100%-1.5rem))] max-h-[min(70dvh,36rem)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-panel max-lg:left-3 max-lg:max-h-[min(40dvh,20rem)] ${tallSheet ? "max-lg:max-h-40" : ""}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-soft px-3 py-2">
        <h2 className="text-sm font-semibold">Details</h2>
        <button type="button" className="btn btn-ghost" aria-label="Close details" onClick={closeDetail}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3 text-sm leading-6">
        <DetailBody />
      </div>
    </aside>
  );
}

function DetailBody() {
  const { state } = useWorkspace();
  const detail = state.detail;
  if (!detail) return null;
  if (detail.type === "vessel") return <VesselDetail device={detail.device} />;
  if (detail.type === "hub") return <HubDetail fx={detail.fx} fy={detail.fy} />;
  if (detail.type === "connection") return <ConnectionDetail id={detail.id} />;
  if (detail.type === "location") return <LocationDetail id={detail.id} />;
  return <ScenarioDetail id={detail.id} />;
}

function VesselDetail({ device }: { device: number }) {
  const { dataset } = useDataset();
  const { frame } = usePlaybackClock();
  const { state } = useWorkspace();
  if (!dataset || device < 0 || device >= dataset.names.length) return <p className="text-fg-muted">That vessel is not in the loaded day.</p>;
  const position = frame?.positions.find((item) => item.device === device);
  const index = position?.index;
  const when = index == null ? null : dataset.timeMs[index];
  const clock = when == null ? null : state.clock === "mvt" ? formatMvt(when) : formatUtc(when);
  const windowCount = frame ? trailIndexes(dataset, device, frame.cursorMs, frame.windowMs).length : 0;
  const network = index == null ? -1 : dataset.network[index];
  const heading = index == null ? -1 : dataset.heading[index];
  const gsm = index == null ? -1 : dataset.gsm[index];

  return (
    <div>
      <p className="text-xs text-ocean">Vessel observation</p>
      <p className="font-semibold text-primary">{maskDevice(dataset.names[device] ?? "")}</p>
      {index == null || when == null ? (
        <p className="mt-2 text-fg-muted">No ping in this window.</p>
      ) : (
        <dl className="mt-2 space-y-1">
          <Row label="Observation" value={clock ?? "—"} />
          <Row label="Reported speed" value={`${dataset.speed[index].toFixed(1)} (unit unverified)`} />
          <Row label="Position" value={`${dataset.lat[index].toFixed(4)}°, ${dataset.lon[index].toFixed(4)}°`} />
          {heading >= 0 ? <Row label="Heading" value={`${heading}°`} /> : null}
          {network >= 0 ? <Row label="Network field" value={network === 1 ? "Dhiraagu" : network === 2 ? "Ooredoo" : "Other"} /> : null}
          {gsm >= 0 ? <Row label="GSM level" value={String(gsm)} /> : null}
        </dl>
      )}
      <p className="mt-2 text-fg-secondary">{windowCount} pings fall in the bold trail window. {formatCount(dataset.tracks[device]?.length ?? 0)} pings are in this day.</p>
      <p className="text-xs text-fg-muted">The trail is the tracker’s own reports. Playback speed does not change these values.</p>
    </div>
  );
}

function HubDetail({ fx, fy }: { fx: number; fy: number }) {
  const { frame, cursor } = usePlaybackClock();
  const { windowMs, mode, cellDeg } = usePlaybackSettings();
  const { state } = useWorkspace();
  const hub = frame?.hubs.find((item) => item.fx === fx && item.fy === fy);
  const windowLabel = WINDOW_OPTIONS.find((option) => option.ms === windowMs)?.label ?? `${Math.round(windowMs / 60_000)} min`;
  const cellLabel = CELL_OPTIONS.find((option) => option.deg === cellDeg)?.label ?? `${cellDeg}°`;
  const clock = state.clock === "mvt" ? formatMvt(cursor) : formatUtc(cursor);

  return (
    <div>
      <p className="text-xs text-ocean">Activity cell</p>
      <p className="font-semibold">{hub ? `${hub.devices} unique ${hub.devices === 1 ? "vessel" : "vessels"}` : "No devices in this window"}</p>
      <dl className="mt-2 space-y-1">
        <Row label="Window end" value={clock} />
        <Row label="Window" value={windowLabel} />
        <Row label="Classification" value={MODE_LABEL[mode]} />
        <Row label="Grid" value={cellLabel} />
        {hub ? <Row label="Cell centre" value={`${hub.centerLat.toFixed(3)}°, ${hub.centerLon.toFixed(3)}°`} /> : null}
      </dl>
      <p className="mt-2 text-xs text-fg-muted">A cell counts unique tracked devices. Stopped means reported speed under {STOP_SPEED_KN}. It is not a harbour.</p>
    </div>
  );
}

function ConnectionDetail({ id }: { id: string }) {
  const { links, areaLinks, journeys, indicators, monthIndicators } = useDataset();
  const { state } = useWorkspace();
  const indicator = [...monthIndicators, ...indicators].find((item) => item.id === id) ?? null;
  if (indicator) return <IndicatorDetail indicator={indicator} hypothetical={state.networkTab === "routes"} />;
  const link = findLink([...areaLinks, ...links], id);
  if (!link) return <p className="text-fg-muted">That connection is not in the current window.</p>;
  const gaps = journeys.filter((journey) => journey.coverageGap && journey.origin.areaId === ("originId" in link ? link.originId : "")).length;
  return (
    <div>
      <p className="text-xs text-cyan">{link.placeKind === "inferred_activity" ? "Inferred cluster" : "Named polygon"}</p>
      <p className="font-semibold">{link.origin} → {link.destination}</p>
      <dl className="mt-2 space-y-1">
        <Row label="Observed passages" value={formatCount(link.tripCount)} />
        <Row label="Typical time" hint="Median duration" value={formatDuration(link.medianDurationMs)} />
        <Row label="Straight-line distance" value={formatKm(link.medianDistanceM)} />
        <Row label="Coverage gaps excluded" value={formatCount(gaps)} />
      </dl>
    </div>
  );
}

function IndicatorDetail({ indicator, hypothetical }: { indicator: ConnectionIndicator; hypothetical: boolean }) {
  const rate = passagesPerObservedDay(indicator);
  const variability = durationVariability(indicator);
  const small = indicator.passages < CONNECTIVITY.minPassagesForIqr;
  return (
    <div>
      <p className="text-xs text-ocean">{indicator.scope === "month" ? "August summary" : "Loaded day"} · {indicator.evidence === "adequate" ? "Enough journeys to compare" : indicator.evidence === "limited" ? "Limited evidence" : "Small sample"}</p>
      <p className="font-semibold">{indicator.origin.label} → {indicator.destination.label}</p>
      <dl className="mt-2 space-y-1">
        <Row label="Journeys" value={formatCount(indicator.passages)} />
        <Row label="Tracked vessels" hint="Distinct devices on any passage, including ones left out of the times" value={formatCount(indicator.vessels)} />
        {indicator.credibleVessels != null ? <Row label="Vessels on credible journeys" value={formatCount(indicator.credibleVessels)} /> : <Row label="Vessels on credible journeys" value="Not separated in the August file" />}
        <Row label="Per observed day" value={rate == null ? "—" : rate.toFixed(1)} />
        <Row label="Days with a journey" value={`${indicator.activeDays} of ${indicator.observationDays}`} />
        <Row label="Typical time" hint="Median duration" value={indicator.medianDurationMs == null ? "—" : formatDuration(indicator.medianDurationMs)} />
        <Row label="Middle half of times" hint="Interquartile range" value={indicator.iqrMs == null ? "Needs more journeys" : formatDuration(indicator.iqrMs)} />
        <Row label="Longer journeys" hint="90th percentile" value={indicator.p90Ms == null ? "Needs more journeys" : formatDuration(indicator.p90Ms)} />
        <Row label="Straight-line separation" value={indicator.medianDistanceM == null ? "—" : formatKm(indicator.medianDistanceM)} />
        <Row label="Tracked path vs separation" value={indicator.medianPathRatio == null ? "—" : `${indicator.medianPathRatio.toFixed(1)}×`} />
        <Row label="Left out of the times" value={formatCount(indicator.excluded)} />
      </dl>
      {variability != null && !small ? <p className="mt-2 text-fg-secondary">The spread of times is {Math.round(variability * 100)}% of the typical time.</p> : null}
      {small ? <p className="mt-2 text-xs text-fg-muted">Fewer than {CONNECTIVITY.minPassagesForIqr} journeys. Treat the typical time as a hint, not a stable figure.</p> : null}
      <p className="mt-2 text-xs text-fg-muted">Times use journeys with continuous-enough tracking. A quiet day is not evidence that no boat sailed. The straight line is not a navigable route. The recorded speed has no documented unit. The 40-knot check uses straight-line distance over time and does not convert that column.</p>
      <button type="button" className="btn mt-2 no-print" onClick={() => downloadText("seapulse-connection.csv", connectivityCsv([indicator], summarizeFrequency({ indicators: [indicator] })))}>Export this connection</button>
      {hypothetical ? <p className="mt-2 rounded-md border border-warning bg-warning-soft px-2 py-1 text-xs">A typed duration in Route Lab is a hypothetical check against this typical time. It is not a schedule.</p> : null}
    </div>
  );
}

function LocationDetail({ id }: { id: string }) {
  const { indicators, monthIndicators, census, geography } = useDataset();
  const { state } = useWorkspace();
  const source = state.network.scope === "month" ? monthIndicators : indicators;
  const population = census ?? { lookup: () => ({ status: "unavailable" as const, population: null, year: null, method: null }) };
  const windowIndicators = source.length > 0 ? source : [...indicators, ...monthIndicators];
  const polygon = geography?.polygons.find((item) => item.id === id) ?? null;
  const profile = polygon ? buildIslandProfile(polygon, windowIndicators, population) : buildLocationProfile(id, windowIndicators, population);
  if (!profile) return <p className="text-fg-muted">That place has no observed connection in this window.</p>;
  return (
    <div>
      <p className="text-xs text-ocean">{profile.confidence === "inferred" ? "Inferred activity area" : profile.confidence === "near_harbour" ? "Near a harbour reference point" : "Named place"}</p>
      <p className="font-semibold">{profile.label}</p>
      {profile.nameDv ? <p className="text-fg-secondary">{profile.nameDv}</p> : null}
      {profile.atoll ? <p className="text-fg-secondary">{profile.atoll}</p> : null}
      <dl className="mt-2 space-y-1">
        <Row label="Arrivals" value={formatCount(profile.arrivals)} />
        <Row label="Departures" value={formatCount(profile.departures)} />
        <Row label="Most vessels on one connection" value={formatCount(profile.vessels)} />
        <Row label="Connected places" value={formatCount(profile.links.length)} />
        <Row label="Window" value={`${profile.observationDays} ${profile.scope === "month" ? "days in the August summary" : "loaded day"}`} />
        {profile.populationStatus === "not_applicable" ? null : (
          <Row label="Residents (Census 2022)" value={residentLabel(profile.populationStatus, profile.population)} />
        )}
        {profile.populationStatus === "matched" ? <Row label="Census match" value={matchLabel(profile.populationMethod)} /> : null}
      </dl>
      <p className="mt-2 text-xs text-fg-muted">{residentNote(profile.populationStatus, profile.populationMethod)}</p>
      <ul className="mt-2 space-y-1">
        {profile.links.slice(0, 6).map((link) => (
          <li key={`${link.direction}:${link.indicator.id}`} className="text-fg-secondary">
            {link.direction === "arrival" ? "From" : "To"} {link.other.label}: {formatCount(link.indicator.passages)} journeys, typical {link.indicator.medianDurationMs == null ? "—" : formatDuration(link.indicator.medianDurationMs)}
          </li>
        ))}
      </ul>
      {profile.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-fg-muted">{warning}</p>)}
    </div>
  );
}

function ScenarioDetail({ id }: { id: string }) {
  const { dataset, geography } = useDataset();
  const { frame } = usePlaybackClock();
  const { state } = useWorkspace();
  const { scenario } = state;
  if (!dataset || !frame || !scenario.incident) return <p className="text-fg-muted">Place a hypothetical incident to compare response times.</p>;
  const facilities = geography?.facilities ?? [];
  const option = compareResponses({
    dataset,
    frame,
    incident: scenario.incident,
    radiusM: scenario.radiusKm * 1000,
    vesselSpeedKn: scenario.vesselKn,
    coastGuardSpeedKn: scenario.coastGuardKn,
    facilities,
    hypotheticalCoastGuard: scenario.coastGuard,
  }).find((item) => item.id === id);
  const clock = state.clock === "mvt" ? formatMvt(frame.cursorMs) : formatUtc(frame.cursorMs);
  if (!option) return <p className="text-fg-muted">That comparison is not in the current window.</p>;

  return (
    <div>
      <p className="text-xs text-danger">{EVIDENCE[option.evidence]}</p>
      <h3 className="font-semibold">{option.evidence === "observed_position" ? maskDevice(option.label) : option.label}</h3>
      <dl className="mt-2 space-y-1">
        <Row label="Historical time" value={clock} />
        <Row label="Distance" value={`${formatKm(option.distanceM)} straight line`} />
        <Row label="Speed used" value={`${option.assumedSpeedKn.toFixed(1)} ${option.speedSource === "reported_ping" ? "reported on that ping" : "assumed"}`} />
        <Row label="To incident" value={formatMinutes(option.etaMin)} />
        <Row label="Then to care" value={option.medicalLegMin == null ? "Not available" : formatMinutes(option.medicalLegMin)} />
      </dl>
      <p className="mt-2 rounded-md border border-warning bg-warning-soft px-2 py-1 text-xs">
        {historicalLabel(dataset.periodLabel)}. Straight-line time is not a dispatch. Coast Guard speed is an assumption. The speed unit is unverified. {option.note}
      </p>
    </div>
  );
}

function residentLabel(status: "matched" | "ambiguous" | "unmatched" | "not_applicable" | "unavailable", population: number | null): string {
  if (status === "matched" && population != null) return formatCount(population);
  if (status === "ambiguous") return "Ambiguous name";
  if (status === "unavailable") return "Not loaded";
  return "No verified match";
}

function matchLabel(method: CensusMatchMethod | null): string {
  if (method === "atoll_name") return "Atoll and name";
  if (method === "unique_name") return "Unique name only";
  if (method === "code") return "Official code";
  return "Matched";
}

function residentNote(
  status: "matched" | "ambiguous" | "unmatched" | "not_applicable" | "unavailable",
  method: CensusMatchMethod | null,
): string {
  if (status === "matched" && method === "atoll_name") return "Matched by atoll and island name in Census 2022. Resident population is geographic context, not transport demand or proof of insufficient service.";
  if (status === "matched" && method === "unique_name") return "Matched because the name is unique in both the reference file and Census 2022. The island had no atoll on the geography, so this is not an atoll-and-name confirmation. Population is context, not demand.";
  if (status === "matched" && method === "code") return "Matched by an official island code in Census 2022. Population is geographic context, not transport demand.";
  if (status === "matched") return "Resident population, Census 2022. Context beside observed journeys, not a passenger count or an isolation score.";
  if (status === "ambiguous") return "This name occurs in more than one atoll, and the reference geography did not select one. No population is shown.";
  if (status === "not_applicable") return "Population is shown only when a stop falls inside a named island that matches Census 2022.";
  if (status === "unavailable") return "Census 2022 is not loaded. No population is shown.";
  return "No Census 2022 row matched this place by code, by atoll and name, or by a unique name. No population is shown.";
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted" title={hint}>{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}
