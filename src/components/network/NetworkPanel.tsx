"use client";

import { useEffect, useMemo } from "react";

import { useMapOverlay } from "@/components/layout/useMapOverlay";
import { Notice } from "@/components/ui/Metrics";
import { useDataset } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { lowConnectivity } from "@/lib/analytics/network";
import { formatCount, formatDuration, formatKm, formatMinutes } from "@/lib/format";
import { ringCentroid } from "@/lib/parsing/geojson";
import { describeObservation, simulateConnection } from "@/lib/simulation/routes";
import { linkKey } from "@/lib/workspace/connection";
import type { NetworkTab } from "@/lib/workspace/state";
import type { MapLine } from "@/types/map";
import type { AreaLink, IslandLink } from "@/types/maritime";

export function NetworkPanel() {
  const { dataset, geography, links, areaLinks, areas, journeys } = useDataset();
  const { state, setNetworkTab, openDetail, focusOn, patchRoute } = useWorkspace();
  const polygons = geography?.polygons;
  const named = useMemo(() => (polygons ?? []).filter((polygon) => polygon.name), [polygons]);
  const quiet = lowConnectivity(polygons ?? [], links);
  const gaps = journeys.filter((journey) => journey.coverageGap).length;
  const choices = state.route.placeKind === "named_island" ? links : areaLinks;
  const selected = choices.find((link) => linkKey(link) === state.route.pair) ?? choices[0] ?? null;
  const activeId = state.detail?.type === "connection" ? state.detail.id : selected && state.networkTab === "routes" ? linkKey(selected) : null;

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if ((tab === "routes" || tab === "observed") && tab !== state.networkTab) setNetworkTab(tab);
  }, [setNetworkTab, state.networkTab]);

  const lines = useMemo<MapLine[]>(() => {
    const inferred = areaLinks.slice(0, 40).map((link) => ({
      id: linkKey(link),
      kind: "inferred" as const,
      coordinates: [[link.originLon, link.originLat], [link.destinationLon, link.destinationLat]] as [number, number][],
      active: linkKey(link) === activeId,
    }));
    const namedLines = links.flatMap((link) => {
      const origin = named.find((polygon) => polygon.name === link.origin);
      const destination = named.find((polygon) => polygon.name === link.destination);
      const from = origin ? ringCentroid(origin.rings[0] ?? []) : null;
      const to = destination ? ringCentroid(destination.rings[0] ?? []) : null;
      if (!from || !to) return [];
      return [{
        id: linkKey(link),
        kind: "named" as const,
        coordinates: [[from.lon, from.lat], [to.lon, to.lat]] as [number, number][],
        active: linkKey(link) === activeId,
      }];
    });
    return [...inferred, ...namedLines];
  }, [areaLinks, links, named, activeId]);

  const overlay = useMemo(() => ({ clickMode: "vessel" as const, markers: [], lines }), [lines]);
  useMapOverlay(overlay);

  function chooseTab(tab: NetworkTab) {
    setNetworkTab(tab);
    window.history.replaceState(null, "", tab === "routes" ? "/network?tab=routes" : "/network");
  }

  function chooseLink(link: AreaLink | IslandLink) {
    const id = linkKey(link);
    patchRoute({ pair: id });
    openDetail({ type: "connection", id });
    if (link.placeKind === "inferred_activity") focusOn((link.originLon + link.destinationLon) / 2, (link.originLat + link.destinationLat) / 2);
  }

  return (
    <>
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Network</h1>
        <p className="mt-1 text-sm leading-6 text-fg-secondary">Observed dwell-to-dwell directions, kept apart from a hypothetical time check.</p>
      </header>
      {!dataset ? <Notice>Load a tracker day in Explore before looking for observed connections.</Notice> : null}
      <div role="tablist" aria-label="Network" className="flex flex-wrap gap-1">
        <button type="button" role="tab" aria-selected={state.networkTab === "observed"} className={state.networkTab === "observed" ? "btn btn-primary" : "btn"} onClick={() => chooseTab("observed")}>
          Observed
        </button>
        <button type="button" role="tab" aria-selected={state.networkTab === "routes"} className={state.networkTab === "routes" ? "btn btn-primary" : "btn"} onClick={() => chooseTab("routes")}>
          Route Lab
        </button>
      </div>
      {dataset?.synthetic ? <Notice tone="warning">Synthetic test geometry. Do not read these links as real atoll services.</Notice> : null}
      {state.networkTab === "observed" ? (
        <ObservedTab
          areas={areas.length}
          areaLinks={areaLinks}
          links={links}
          namedCount={named.length}
          quiet={quiet}
          gaps={gaps}
          activeId={activeId}
          onChoose={chooseLink}
        />
      ) : (
        <RouteTab choices={choices} selected={selected} onChoose={chooseLink} />
      )}
    </>
  );
}

function ObservedTab({
  areas,
  areaLinks,
  links,
  namedCount,
  quiet,
  gaps,
  activeId,
  onChoose,
}: {
  areas: number;
  areaLinks: AreaLink[];
  links: IslandLink[];
  namedCount: number;
  quiet: { name: string; observedLinks: number; tripCount: number }[];
  gaps: number;
  activeId: string | null;
  onChoose: (link: AreaLink | IslandLink) => void;
}) {
  return (
    <>
      <Notice>A missing link is not evidence that an island has no transport. A cluster is not a terminal.</Notice>
      <p className="text-sm leading-6 text-fg-secondary">{formatCount(gaps)} jumps stayed out of both lists because the implied straight-line speed exceeded 40 or the clock did not move.</p>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Inferred activity areas</h2>
        <p className="text-xs leading-5 text-fg-muted">{formatCount(areas)} areas with a dwell. {formatCount(areaLinks.length)} directions between different areas.</p>
        {areaLinks.length === 0 ? <p className="text-sm text-fg-muted">No credible passage joins two different areas in this day.</p> : (
          <ul className="space-y-2">
            {areaLinks.slice(0, 8).map((link) => (
              <li key={linkKey(link)}>
                <ConnectionButton link={link} active={linkKey(link) === activeId} onChoose={onChoose} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Named polygons</h2>
        {namedCount === 0 ? <p className="text-sm text-fg-muted">No island file is loaded. Passages are not assigned to island names.</p> : links.length === 0 ? (
          <p className="text-sm text-fg-muted">No credible passage starts and ends in two different named polygons.</p>
        ) : (
          <ul className="space-y-2">
            {links.map((link) => (
              <li key={linkKey(link)}>
                <ConnectionButton link={link} active={linkKey(link) === activeId} onChoose={onChoose} />
              </li>
            ))}
          </ul>
        )}
        {namedCount > 0 ? (
          <>
            <h3 className="text-sm font-semibold">Few observed directions</h3>
            <ul className="space-y-1 text-sm text-fg-secondary">
              {quiet.map((item) => (
                <li key={item.name}>{item.name}: {item.observedLinks} directions, {item.tripCount} passages</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </>
  );
}

function RouteTab({
  choices,
  selected,
  onChoose,
}: {
  choices: (AreaLink | IslandLink)[];
  selected: AreaLink | IslandLink | null;
  onChoose: (link: AreaLink | IslandLink) => void;
}) {
  const { dataset } = useDataset();
  const { state, patchRoute } = useWorkspace();
  const observation = useMemo(
    () => describeObservation(selected, dataset?.quality.medianMovingKn ?? null),
    [selected, dataset],
  );
  const namedHypothetical = selected?.placeKind === "named_island"
    ? simulateConnection(selected, selected.origin, selected.destination, state.route.proposedMin)
    : null;
  const difference = selected?.placeKind === "named_island"
    ? namedHypothetical?.differenceMin ?? null
    : observation.observedMedianMin == null ? null : observation.observedMedianMin - state.route.proposedMin;

  return (
    <>
      <Notice tone="warning">Hypothetical check. The typed duration is not taken from the file and is not a schedule.</Notice>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={state.route.placeKind === "inferred_activity" ? "btn btn-primary" : "btn"} onClick={() => patchRoute({ placeKind: "inferred_activity", pair: "" })}>
          Inferred areas
        </button>
        <button type="button" className={state.route.placeKind === "named_island" ? "btn btn-primary" : "btn"} onClick={() => patchRoute({ placeKind: "named_island", pair: "" })}>
          Named polygons
        </button>
      </div>
      {choices.length === 0 ? (
        <Notice>{state.route.placeKind === "named_island" ? "No named-polygon passage is in this day." : "This day has no credible passage between two inferred areas."}</Notice>
      ) : (
        <label className="field">
          Observed direction
          <select value={selected ? linkKey(selected) : ""} onChange={(event) => {
            const link = choices.find((item) => linkKey(item) === event.target.value);
            if (link) onChoose(link);
          }}>
            {choices.slice(0, 40).map((link) => (
              <option key={linkKey(link)} value={linkKey(link)}>
                {link.origin} → {link.destination} ({link.tripCount})
              </option>
            ))}
          </select>
        </label>
      )}
      {selected ? (
        <article className="rounded-lg border border-border bg-surface p-3 text-sm leading-6">
          <p className="text-xs text-fg-muted">Observed</p>
          <h2 className="font-medium">{observation.origin} → {observation.destination}</h2>
          <p className="text-fg-secondary">Passages {formatCount(observation.observedTrips)} · median {formatMinutes(observation.observedMedianMin)}</p>
          <p className="text-fg-secondary">Range {formatMinutes(observation.observedShortestMin)} – {formatMinutes(observation.observedLongestMin)}</p>
          <p className="text-fg-secondary">Median straight line {observation.observedMedianM == null ? "—" : formatKm(observation.observedMedianM)}</p>
          <p className="text-fg-secondary">
            Straight-line reference {formatMinutes(observation.straightLineMin)} at {observation.reportedMovingKn == null ? "—" : observation.reportedMovingKn.toFixed(1)} reported moving value.
          </p>
          <p>
            {observation.extraMin == null
              ? "No reference time."
              : `Observed median is ${formatMinutes(Math.abs(observation.extraMin))} ${observation.extraMin >= 0 ? "longer" : "shorter"} than that reference.`}
          </p>
        </article>
      ) : null}
      <label className="field">
        Hypothetical direct time (minutes)
        <input type="number" min={1} step={1} value={state.route.proposedMin} onChange={(event) => patchRoute({ proposedMin: Number(event.target.value) || 1 })} />
      </label>
      {selected ? (
        <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm leading-6">
          Hypothetical: {formatDuration(state.route.proposedMin * 60_000)} is{" "}
          {difference == null ? "not comparable." : `${formatMinutes(Math.abs(difference))} ${difference >= 0 ? "shorter" : "longer"} than the observed median.`}
          {" "}This entry is not a route from the file.
        </p>
      ) : null}
      <p className="text-xs leading-5 text-fg-muted">The reference ignores channels and waiting. Extra time is not a measured delay. Speed units are unverified.</p>
    </>
  );
}

function ConnectionButton({ link, active, onChoose }: { link: AreaLink | IslandLink; active: boolean; onChoose: (link: AreaLink | IslandLink) => void }) {
  return (
    <button type="button" aria-pressed={active} className={`w-full rounded-lg border px-3 py-2 text-left text-sm leading-6 ${active ? "border-primary bg-primary-soft" : "border-border bg-surface"}`} onClick={() => onChoose(link)}>
      <p className="font-medium">{link.origin} → {link.destination}</p>
      <p className="text-fg-secondary">{formatCount(link.tripCount)} passages · median {formatDuration(link.medianDurationMs)} · {formatKm(link.medianDistanceM)} straight line</p>
    </button>
  );
}
