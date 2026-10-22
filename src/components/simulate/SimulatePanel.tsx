"use client";

import { useCallback, useMemo } from "react";

import { useMapOverlay } from "@/components/layout/useMapOverlay";
import { Notice } from "@/components/ui/Metrics";
import { useDataset, usePlaybackClock } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { distanceM } from "@/lib/geo/distance";
import { formatKm, formatMinutes, formatNm, historicalLabel, maskDevice } from "@/lib/format";
import { compareResponses } from "@/lib/simulation/emergency";
import type { MapLine, MapMarker } from "@/types/map";
import type { ResponseOption } from "@/types/maritime";

const EVIDENCE: Record<ResponseOption["evidence"], string> = {
  observed_position: "Historical observation",
  verified_coast_guard: "Verified Coast Guard site",
  unverified_coast_guard: "Unverified loaded site",
  hypothetical_coast_guard: "Hypothetical origin",
};

export function SimulatePanel() {
  const { dataset, geography } = useDataset();
  const { frame } = usePlaybackClock();
  const { state, patchScenario, openDetail } = useWorkspace();
  const { scenario } = state;
  const facilities = useMemo(() => geography?.facilities ?? [], [geography]);
  const verifiedMedical = facilities.filter((facility) => facility.kind === "medical" && facility.verified);
  const options = useMemo(() => {
    if (!dataset || !frame || !scenario.incident) return [];
    return compareResponses({
      dataset,
      frame,
      incident: scenario.incident,
      radiusM: scenario.radiusKm * 1000,
      vesselSpeedKn: scenario.vesselKn,
      coastGuardSpeedKn: scenario.coastGuardKn,
      facilities,
      hypotheticalCoastGuard: scenario.coastGuard,
    });
  }, [dataset, frame, scenario.incident, scenario.radiusKm, scenario.vesselKn, scenario.coastGuardKn, scenario.coastGuard, facilities]);

  const markers = useMemo<MapMarker[]>(() => [
    ...(scenario.incident ? [{ id: "incident", lon: scenario.incident.lon, lat: scenario.incident.lat, kind: "incident" as const, label: "Hypothetical incident" }] : []),
    ...(scenario.coastGuard ? [{ id: "cg", lon: scenario.coastGuard.lon, lat: scenario.coastGuard.lat, kind: "hypothetical" as const, label: "Hypothetical Coast Guard origin" }] : []),
  ], [scenario.incident, scenario.coastGuard]);

  const lines = useMemo<MapLine[]>(() => {
    if (!scenario.incident || !dataset || !frame) return [];
    return options.flatMap((option) => {
      const origin = option.evidence === "hypothetical_coast_guard"
        ? scenario.coastGuard
        : option.evidence === "observed_position"
          ? positionOf(dataset, frame, option.id)
          : facilityPoint(facilities, option.id);
      if (!origin) return [];
      return [{
        id: option.id,
        kind: "response" as const,
        active: state.detail?.type === "scenario" && state.detail.id === option.id,
        coordinates: [[origin.lon, origin.lat], [scenario.incident!.lon, scenario.incident!.lat]] as [number, number][],
      }];
    });
  }, [options, scenario.incident, scenario.coastGuard, dataset, frame, facilities, state.detail]);

  const onPlace = useCallback((lat: number, lon: number) => {
    if (scenario.placing === "coast_guard") patchScenario({ coastGuard: { lat, lon } });
    else patchScenario({ incident: { lat, lon } });
  }, [scenario.placing, patchScenario]);
  const overlay = useMemo(() => ({ clickMode: scenario.placing, markers, lines, onPlace }), [scenario.placing, markers, lines, onPlace]);
  useMapOverlay(overlay);

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Simulate</h1>
        <p className="mt-1 text-sm leading-6 text-fg-secondary">Hypothetical incident times from historical positions. This does not dispatch a vessel.</p>
      </header>
      {!dataset ? <Notice>Load a tracker day in Explore before comparing response times.</Notice> : null}
      {dataset ? <Notice tone="warning">{historicalLabel(dataset.periodLabel)}. A dot is a past report in the selected window, not a boat that can respond now.</Notice> : null}
      {dataset?.synthetic ? <Notice tone="warning">The loaded file and any sample facilities are synthetic.</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={scenario.placing === "incident" ? "btn btn-primary" : "btn"} onClick={() => patchScenario({ placing: "incident" })}>Place incident</button>
        <button type="button" className={scenario.placing === "coast_guard" ? "btn btn-primary" : "btn"} onClick={() => patchScenario({ placing: "coast_guard" })}>Place Coast Guard origin</button>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <label className="field">Radius km<input type="number" min={1} step={1} value={scenario.radiusKm} onChange={(event) => patchScenario({ radiusKm: Number(event.target.value) || 1 })} /></label>
        <label className="field">Fallback speed<input type="number" min={1} step={1} value={scenario.vesselKn} onChange={(event) => patchScenario({ vesselKn: Number(event.target.value) || 1 })} /></label>
        <label className="field">Coast Guard speed<input type="number" min={1} step={1} value={scenario.coastGuardKn} onChange={(event) => patchScenario({ coastGuardKn: Number(event.target.value) || 1 })} /></label>
      </div>
      <p className="text-xs leading-5 text-fg-muted">When the historical ping reports at least 1, that value is used. Otherwise the fallback speed is an assumption. Coast Guard speed is always an assumption. The unit is unverified. These speeds are not playback speed.</p>
      {verifiedMedical.length === 0 ? <Notice>No verified medical facility is loaded, so no evacuation leg is added.</Notice> : (
        <ul className="text-sm text-fg-secondary">
          {verifiedMedical.map((facility) => (
            <li key={facility.id}>
              {facility.name}
              {scenario.incident ? ` · ${formatKm(distanceM(scenario.incident.lon, scenario.incident.lat, facility.lon, facility.lat))} from the incident` : ""}
              {facility.synthetic ? " · synthetic" : ""}
            </li>
          ))}
        </ul>
      )}
      {!scenario.incident ? <p className="text-sm text-fg-muted">Choose “Place incident”, then click the map.</p> : null}
      <div className="space-y-2">
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={state.detail?.type === "scenario" && state.detail.id === option.id}
            className="w-full rounded-lg border border-border bg-surface p-3 text-left text-sm leading-6"
            onClick={() => openDetail({ type: "scenario", id: option.id })}
          >
            <p className="text-xs text-fg-muted">{EVIDENCE[option.evidence]}{index === 0 ? " · shortest combined estimate" : ""}</p>
            <p className="font-medium">{option.evidence === "observed_position" ? maskDevice(option.label) : option.label}</p>
            <p className="text-fg-secondary">{formatKm(option.distanceM)} · {formatNm(option.distanceM)} · {option.assumedSpeedKn.toFixed(1)} {option.speedSource === "reported_ping" ? "reported" : "assumed"}</p>
            <p>Combined: {option.medicalLegMin == null ? formatMinutes(option.etaMin) : formatMinutes(option.combinedMin)}</p>
          </button>
        ))}
      </div>
    </>
  );
}

function positionOf(dataset: { lon: Float32Array; lat: Float32Array }, frame: { positions: { device: number; index: number }[] } | null, id: string) {
  const device = Number(id.slice("vessel-".length));
  const position = frame?.positions.find((item) => item.device === device);
  if (!position) return null;
  return { lon: dataset.lon[position.index], lat: dataset.lat[position.index] };
}

function facilityPoint(facilities: { id: string; lon: number; lat: number }[], id: string) {
  const facility = facilities.find((item) => item.id === id);
  return facility ? { lon: facility.lon, lat: facility.lat } : null;
}
