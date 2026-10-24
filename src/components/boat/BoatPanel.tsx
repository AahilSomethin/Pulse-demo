"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";

import { useMapOverlay } from "@/components/layout/useMapOverlay";
import { Notice } from "@/components/ui/Metrics";
import { useDataset } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { formatKm, historicalLabel } from "@/lib/format";
import {
  boatLabel,
  boatRoster,
  incidentKey,
  passesNearIncident,
  routeBounds,
  routeKey,
  routeLabel,
  routesForDevice,
} from "@/lib/simulation/rescue";
import type { MapLine, MapMarker } from "@/types/map";
import type { Journey } from "@/types/maritime";

export function BoatPanel() {
  const { dataset, journeys } = useDataset();
  const { state, setBoatDevice, recordConsent, resetBoat, focusOn } = useWorkspace();
  const roster = useMemo(() => boatRoster(journeys), [journeys]);
  const source = dataset?.sourceLabel ?? "";

  useEffect(() => {
    if (source && state.boatSource && state.boatSource !== source) resetBoat();
  }, [source, state.boatSource, resetBoat]);

  const device = state.boatDevice != null && state.boatSource === source && roster.includes(state.boatDevice) ? state.boatDevice : null;
  const routes = useMemo(() => (device == null ? [] : routesForDevice(journeys, device)), [journeys, device]);
  const ownCount = device == null ? 0 : journeys.filter((journey) => journey.device === device).length;
  const radiusM = state.scenario.radiusKm * 1000;
  const passes = useMemo(() => {
    if (device == null || !state.scenario.incident) return [];
    return passesNearIncident(journeys, device, state.scenario.incident, radiusM);
  }, [device, journeys, state.scenario.incident, radiusM]);
  const closest = passes[0] ?? null;
  const pinKey = state.scenario.incident ? incidentKey(state.scenario.incident) : null;
  const answer = closest && pinKey
    ? state.consents.find((item) => item.device === device && item.routeKey === closest.routeKey && item.incidentKey === pinKey) ?? null
    : null;

  useEffect(() => {
    if (device == null) return;
    const bounds = routeBounds(routes);
    if (!bounds) return;
    focusOn((bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2, { bounds });
  }, [device, routes, focusOn]);

  const markers = useMemo<MapMarker[]>(() => (
    state.scenario.incident
      ? [{ id: "incident", lon: state.scenario.incident.lon, lat: state.scenario.incident.lat, kind: "incident", label: "Hypothetical incident" }]
      : []
  ), [state.scenario.incident]);

  const lines = useMemo<MapLine[]>(() => routes.map((journey) => ({
    id: routeKey(journey),
    kind: journey.origin.islandName && journey.destination.islandName ? "named" : "inferred",
    active: closest?.routeKey === routeKey(journey),
    coordinates: [
      [journey.origin.lon, journey.origin.lat],
      [journey.destination.lon, journey.destination.lat],
    ],
  })), [routes, closest]);

  useMapOverlay(useMemo(() => ({ clickMode: "vessel" as const, markers, lines }), [markers, lines]));

  const name = device == null || !dataset ? "" : dataset.names[device] ?? "";

  return (
    <>
      <header data-tour="boat-operator">
        <h1 className="text-lg font-semibold tracking-tight">Boat operator <span className="text-xs font-medium text-fg-muted">Demo</span></h1>
        <p className="mt-1 text-sm leading-6 text-fg-secondary">One tracked device, and only the routes recorded for that device. Choosing a boat is a demo view. It is not a login, and a consent does not dispatch the boat.</p>
      </header>
      {!dataset ? <Notice>Load a tracker day in Explore. Then choose a boat to see its recorded routes.</Notice> : null}
      {dataset ? <Notice tone="warning">{historicalLabel(dataset.periodLabel)}. These are past passages, not a boat that is sailing now.</Notice> : null}
      {dataset?.synthetic ? <Notice tone="warning">The loaded file is synthetic test data.</Notice> : null}
      {dataset && roster.length === 0 ? <Notice>This file has no credible passage to show as a route.</Notice> : null}
      {dataset && roster.length > 0 ? (
        <label className="field">
          This boat
          <select
            value={device ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              setBoatDevice(next === "" ? null : Number(next), source);
            }}
          >
            <option value="">Choose a tracked device</option>
            {roster.map((item) => (
              <option key={item} value={item}>{boatLabel(roster, item, dataset.names[item] ?? "")}</option>
            ))}
          </select>
        </label>
      ) : null}
      {device != null ? (
        <p className="text-sm text-fg-secondary">{boatLabel(roster, device, name)} sees {routes.length} recorded {routes.length === 1 ? "route" : "routes"}.</p>
      ) : null}
      {device != null && ownCount > routes.length ? (
        <p className="text-xs leading-5 text-fg-muted">Passages with a coverage gap, or that stay on one island, stay off this list. They are not offered as routes.</p>
      ) : null}
      {device != null && !state.scenario.incident ? (
        <Notice>
          Place a hypothetical incident in <Link href="/simulate" className="text-primary">Emergency Simulation</Link>. If a recorded route for this boat passes that pin, a consent card appears here.
        </Notice>
      ) : null}
      {device != null && state.scenario.incident && !closest ? (
        <Notice>
          The hypothetical incident is on the map. No recorded route for this boat passes within {state.scenario.radiusKm} km, so there is no consent to give.
        </Notice>
      ) : null}
      {device != null && closest && pinKey ? (
        <ConsentCard
          boat={boatLabel(roster, device, name)}
          label={closest.label}
          distanceM={closest.distanceM}
          extra={passes.length > 1}
          choice={answer?.choice ?? null}
          onOffer={() => recordConsent({
            device,
            routeKey: closest.routeKey,
            incidentKey: pinKey,
            routeLabel: closest.label,
            choice: "offer",
          })}
          onDecline={() => recordConsent({
            device,
            routeKey: closest.routeKey,
            incidentKey: pinKey,
            routeLabel: closest.label,
            choice: "decline",
          })}
        />
      ) : null}
      {device != null && routes.length > 0 ? (
        <ul className="space-y-2">
          {routes.map((journey) => (
            <RouteRow key={routeKey(journey)} journey={journey} active={closest?.routeKey === routeKey(journey)} onFocus={focusOn} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ConsentCard({
  boat,
  label,
  distanceM,
  extra,
  choice,
  onOffer,
  onDecline,
}: {
  boat: string;
  label: string;
  distanceM: number;
  extra: boolean;
  choice: "offer" | "decline" | null;
  onOffer: () => void;
  onDecline: () => void;
}) {
  const tone = choice === "offer"
    ? "border-success bg-success-soft"
    : choice === "decline"
      ? "border-border bg-surface-sunken"
      : "border-warning bg-warning-soft";
  return (
    <section aria-live="polite" data-tour="boat-consent" className={`rounded-lg border p-3 ${tone}`}>
      <p className="text-xs text-fg-muted">Demo consent · {boat}</p>
      <h2 className="mt-1 text-sm font-semibold">This recorded route passes the hypothetical incident</h2>
      <p className="mt-1 text-sm text-fg">{label}</p>
      <p className="mt-1 text-sm leading-6 text-fg-secondary">The straight line comes within {formatKm(distanceM)} of the pin. The line is not a channel. I pass this route stores an offer for the exercise. It does not send the boat.</p>
      {extra ? <p className="mt-1 text-xs leading-5 text-fg-muted">Other recorded routes also come within the radius. This card asks about the closest.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" aria-pressed={choice === "offer"} onClick={onOffer}>I pass this route</button>
        <button type="button" className="btn" aria-pressed={choice === "decline"} onClick={onDecline}>Not this route</button>
      </div>
      {choice === "offer" ? <p className="mt-2 text-sm text-fg-secondary">Consent recorded. Emergency Simulation lists this offer. Nothing was dispatched.</p> : null}
      {choice === "decline" ? <p className="mt-2 text-sm text-fg-secondary">Recorded as not this route. No offer is listed as accepted.</p> : null}
    </section>
  );
}

function RouteRow({
  journey,
  active,
  onFocus,
}: {
  journey: Journey;
  active: boolean;
  onFocus: (lon: number, lat: number, view?: { zoom?: number; bounds?: { west: number; south: number; east: number; north: number } }) => void;
}) {
  const bounds = routeBounds([journey]);
  return (
    <li>
      <button
        type="button"
        className={`w-full rounded-lg border p-3 text-left text-sm leading-6 ${active ? "border-selected bg-selected-soft" : "border-border bg-surface"}`}
        onClick={() => {
          if (!bounds) return;
          onFocus((bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2, { bounds });
        }}
      >
        <p className="font-medium">{routeLabel(journey)}</p>
        <p className="text-fg-secondary">{formatKm(journey.straightLineM)} straight line</p>
      </button>
    </li>
  );
}
