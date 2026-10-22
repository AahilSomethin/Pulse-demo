"use client";

import { useEffect, useMemo } from "react";

import { useMapOverlay } from "@/components/layout/useMapOverlay";
import { ConnectionCard, ConnectionFilters, atollsFor } from "@/components/network/ConnectionList";
import { Notice } from "@/components/ui/Metrics";
import { CONNECTIVITY } from "@/config/constants";
import { useDataset } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { filterIndicators } from "@/lib/analytics/filters";
import { connectionOverlay } from "@/lib/analytics/map-links";
import { FrequencyReport } from "@/components/network/FrequencyReport";
import { findOpportunities, type Opportunity } from "@/lib/analytics/opportunities";
import { formatCount, formatMinutes } from "@/lib/format";
import { compareScenario, describeBaseline } from "@/lib/simulation/routes";
import type { NetworkTab } from "@/lib/workspace/state";
import type { ConnectionIndicator } from "@/lib/analytics/connectivity";

export function NetworkPanel() {
  const { dataset, indicators, month, monthIndicators, loadMonth, loading, sameIslandPassages, monthSameIslandPassages } = useDataset();
  const { state, setNetworkTab, patchNetwork, patchRoute, openDetail, focusOn } = useWorkspace();
  const source = state.network.scope === "month" ? monthIndicators : indicators;
  const filtered = useMemo(() => filterIndicators(source, state.network), [source, state.network]);
  const activeId = state.detail?.type === "connection" ? state.detail.id : state.route.pair || null;
  const opportunities = useMemo(() => findOpportunities(filtered), [filtered]);
  const overlay = useMemo(() => {
    if (state.networkTab === "routes") {
      const selected = filtered.find((indicator) => indicator.id === state.route.pair) ?? filtered[0] ?? null;
      return connectionOverlay(selected ? [selected] : [], selected?.id ?? null, "selected");
    }
    if (state.networkTab === "opportunities") {
      const flagged = opportunities.flagged.map((item) => item.indicator);
      const selected = flagged.find((indicator) => indicator.id === activeId) ?? null;
      return connectionOverlay(selected ? [selected] : flagged.slice(0, 8), selected?.id ?? null, "opportunity");
    }
    if (state.networkTab === "frequency") return connectionOverlay([], null, "selected");
    return connectionOverlay(filtered, activeId, "overview");
  }, [state.networkTab, state.route.pair, filtered, activeId, opportunities]);
  const mapOverlay = useMemo(
    () => ({ clickMode: "vessel" as const, markers: [], lines: overlay.lines, locations: overlay.locations }),
    [overlay],
  );
  useMapOverlay(mapOverlay);

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if ((tab === "routes" || tab === "observed" || tab === "opportunities" || tab === "frequency") && tab !== state.networkTab) setNetworkTab(tab);
  }, [setNetworkTab, state.networkTab]);

  useEffect(() => {
    if (state.network.scope === "month" && !month && !loading) void loadMonth();
  }, [state.network.scope, month, loading, loadMonth]);

  function chooseTab(tab: NetworkTab) {
    setNetworkTab(tab);
    const query = tab === "observed" ? "" : `?tab=${tab}`;
    window.history.replaceState(window.history.state, "", `/network${query}`);
  }

  function choose(indicator: ConnectionIndicator) {
    patchRoute({ pair: indicator.id });
    openDetail({ type: "connection", id: indicator.id });
    focusOn((indicator.origin.lon + indicator.destination.lon) / 2, (indicator.origin.lat + indicator.destination.lat) / 2);
  }

  return (
    <>
      <header className="no-print flex flex-col gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Network</h1>
          <p className="mt-1 text-sm leading-6 text-fg-secondary">Observed passages between places where tracked vessels stopped. A missing line is not proof that no service exists.</p>
        </div>
      </header>
      {!dataset && state.network.scope === "day" ? <Notice>Load a tracker day in Explore, or switch the window to the August summary after it has been built.</Notice> : null}
      {dataset?.synthetic ? <Notice tone="warning">Synthetic test geometry. Do not read these links as real atoll services.</Notice> : null}
      <ConnectionFilters filters={state.network} atolls={atollsFor(source)} onChange={patchNetwork} />
      {state.network.scope === "month" && !month ? <Notice>The August summary is read from this computer. It is not included in the published app until redistribution of the derived file is confirmed.</Notice> : null}
      {state.networkTab === "observed" ? <p className="text-xs leading-5 text-fg-muted">Every matching connection stays in the list. The map draws them as thin lines and reveals more as you zoom in. A selected line stays visible.</p> : null}
      {state.networkTab === "opportunities" ? <p className="text-xs leading-5 text-fg-muted">The map shows investigation candidates. The selected candidate stays in front, and other network lines stay off the map. Those connections are still in the data.</p> : null}
      {state.networkTab === "routes" ? <p className="text-xs leading-5 text-fg-muted">The map shows the selected connection. The rest of the network stays in the list.</p> : null}
      {(state.network.scope === "month" ? monthSameIslandPassages : sameIslandPassages) > 0 ? (
        <p className="text-xs leading-5 text-fg-muted">{formatCount(state.network.scope === "month" ? monthSameIslandPassages : sameIslandPassages)} passages moved between activity cells on the same named island. They stay in the record and are not shown as inter-island connections.</p>
      ) : null}
      <div role="tablist" aria-label="Network" className="no-print flex flex-wrap gap-1">
        <button type="button" role="tab" aria-selected={state.networkTab === "observed"} className={state.networkTab === "observed" ? "btn btn-primary" : "btn"} onClick={() => chooseTab("observed")}>Connections</button>
        <button type="button" role="tab" data-tour="find-opportunities" aria-selected={state.networkTab === "opportunities"} className={state.networkTab === "opportunities" ? "btn btn-primary" : "btn"} onClick={() => chooseTab("opportunities")}>Find opportunities</button>
        <button type="button" role="tab" data-tour="network-tab-frequency" aria-selected={state.networkTab === "frequency"} className={state.networkTab === "frequency" ? "btn btn-primary" : "btn"} onClick={() => chooseTab("frequency")}>Frequency</button>
        <button type="button" role="tab" data-tour="network-tab-routes" aria-selected={state.networkTab === "routes"} className={state.networkTab === "routes" ? "btn btn-primary" : "btn"} onClick={() => chooseTab("routes")}>Route Lab</button>
      </div>
      {state.networkTab === "observed" ? <ConnectionList indicators={filtered} activeId={activeId} onChoose={choose} /> : null}
      {state.networkTab === "opportunities" ? (
        <OpportunityList
          flagged={opportunities.flagged}
          withheld={opportunities.withheld.length}
          activeId={activeId}
          onChoose={choose}
        />
      ) : null}
      {state.networkTab === "routes" ? <RouteLab indicators={filtered} onChoose={choose} /> : null}
      {state.networkTab === "frequency" ? <FrequencyReport indicators={filtered} /> : null}
    </>
  );
}

function ConnectionList({ indicators, activeId, onChoose }: { indicators: ConnectionIndicator[]; activeId: string | null; onChoose: (indicator: ConnectionIndicator) => void }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Observed connections</h2>
      {indicators.length === 0 ? <p className="text-sm text-fg-muted">No connection matches these filters.</p> : (
        <>
          <p className="text-xs text-fg-muted">{formatCount(indicators.length)} matching {indicators.length === 1 ? "connection" : "connections"}. The map keeps every one and draws the busiest first.</p>
          <ul className="space-y-2">
            {indicators.map((indicator) => (
              <li key={indicator.id}>
                <ConnectionCard indicator={indicator} active={indicator.id === activeId} onChoose={onChoose} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function OpportunityList({
  flagged,
  withheld,
  activeId,
  onChoose,
}: {
  flagged: Opportunity[];
  withheld: number;
  activeId: string | null;
  onChoose: (indicator: ConnectionIndicator) => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Connections worth a closer look</h2>
      <Notice>Each result is a planning question. It is not a recommendation to build or change a route.</Notice>
      {flagged.length === 0 ? <p className="text-sm text-fg-muted">No connection in the current filters has both enough repeated journeys and one of the investigation rules.</p> : (
        <ul className="space-y-2">
          {flagged.map((item) => (
            <li key={item.indicator.id} className="space-y-2">
              <ConnectionCard indicator={item.indicator} active={item.indicator.id === activeId} onChoose={onChoose} />
              <ul className="space-y-1 px-1 text-sm leading-6 text-fg-secondary">
                {item.rules.map((rule) => (
                  <li key={rule.id}>
                    <p className="font-medium text-fg">{rule.title}</p>
                    <p>{rule.detail}</p>
                    <p className="text-fg-muted">{rule.question}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {withheld > 0 ? <p className="text-xs leading-5 text-fg-muted">{formatCount(withheld)} connections are held back because fewer than {CONNECTIVITY.minPassagesAdequate} journeys or {CONNECTIVITY.minVesselsAdequate} vessels support them. They are not ranked.</p> : null}
    </section>
  );
}

function RouteLab({ indicators, onChoose }: { indicators: ConnectionIndicator[]; onChoose: (indicator: ConnectionIndicator) => void }) {
  const { state, patchRoute } = useWorkspace();
  const selected = indicators.find((indicator) => indicator.id === state.route.pair) ?? indicators[0] ?? null;
  const baseline = useMemo(() => describeBaseline(selected), [selected]);
  const scenario = compareScenario(baseline, state.route.proposedMin);
  const peak = Math.max(1, ...baseline.histogram.map((bin) => bin.count));

  return (
    <section className="space-y-2">
      <Notice tone="warning">Hypothetical check against the observed typical time. The typed duration is not a schedule, and a straight line is not a channel.</Notice>
      {indicators.length === 0 ? <p className="text-sm text-fg-muted">No connection is available for this window.</p> : (
        <label className="field">
          Observed connection
          <select value={selected?.id ?? ""} onChange={(event) => {
            const indicator = indicators.find((item) => item.id === event.target.value);
            if (indicator) onChoose(indicator);
          }}>
            {indicators.map((indicator) => (
              <option key={indicator.id} value={indicator.id}>{indicator.origin.label} → {indicator.destination.label} ({indicator.passages})</option>
            ))}
          </select>
        </label>
      )}
      {selected ? (
        <article className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm leading-6">
          <p className="text-xs text-fg-muted">Observed baseline · {baseline.periodLabel} · {baseline.observationDays} observation {baseline.observationDays === 1 ? "day" : "days"}</p>
          <h2 className="font-medium">{selected.origin.label} → {selected.destination.label}</h2>
          <p className="text-fg-secondary">{formatCount(baseline.journeys)} journeys · {formatCount(baseline.vessels)} vessels · {formatCount(baseline.excluded)} left out of the times</p>
          <p className="text-fg-secondary"><span title="Median duration">Typical time</span> {formatMinutes(baseline.medianMin)} · <span title="Interquartile range">middle half</span> {formatMinutes(baseline.iqrMin)} · <span title="90th percentile">longer journeys</span> {formatMinutes(baseline.p90Min)}</p>
          <p className="text-fg-secondary">Straight-line separation {baseline.straightLineKm == null ? "—" : `${baseline.straightLineKm.toFixed(1)} km`} · tracked path {baseline.pathRatio == null ? "—" : `${baseline.pathRatio.toFixed(1)}× that separation`}</p>
          <div className="space-y-1">
            {baseline.histogram.map((bin) => (
              <div key={bin.label} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-xs">
                <span className="text-fg-muted">{bin.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${(bin.count / peak) * 100}%` }} />
                </span>
                <span className="tabular-nums text-fg-secondary">{bin.count}</span>
              </div>
            ))}
          </div>
          {baseline.journeys < CONNECTIVITY.minPassagesForP90 ? <p className="text-xs text-fg-muted">Fewer than {CONNECTIVITY.minPassagesForP90} journeys, so the longer-journey time is not shown. The typical time is a small sample.</p> : null}
        </article>
      ) : null}
      <label className="field">
        Hypothetical direct time (minutes)
        <input type="number" min={1} step={1} value={state.route.proposedMin} onChange={(event) => patchRoute({ proposedMin: Math.max(1, Number(event.target.value) || 1) })} />
      </label>
      {selected ? (
        <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm leading-6">
          {scenario.versusMedianMin == null
            ? "There is no typical time to compare."
            : `The hypothetical time is ${formatMinutes(Math.abs(scenario.versusMedianMin))} ${scenario.versusMedianMin >= 0 ? "shorter" : "longer"} than the typical observed journey.`}
          {scenario.versusP90Min == null ? "" : ` It is ${formatMinutes(Math.abs(scenario.versusP90Min))} ${scenario.versusP90Min >= 0 ? "shorter" : "longer"} than the longer observed journeys.`}
        </p>
      ) : null}
      <div className="space-y-1 text-xs leading-5 text-fg-muted">
        {scenario.evidenceNeeded.map((item) => <p key={item}>{item}</p>)}
      </div>
    </section>
  );
}
