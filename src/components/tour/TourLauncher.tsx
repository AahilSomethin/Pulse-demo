"use client";

import { CircleHelp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";

import { useDataset, usePlaybackSettings } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { findOpportunities } from "@/lib/analytics/opportunities";
import { startTeamGuide } from "@/tour/driver";
import { buildGuideSteps, type GuideStep } from "@/tour/steps";

import "driver.js/dist/driver.css";

export function TourLauncher() {
  const router = useRouter();
  const running = useRef<{ destroy: () => void } | null>(null);
  const { dataset, indicators, monthIndicators, month, census } = useDataset();
  const { setPlaying } = usePlaybackSettings();
  const { state, setSidebar, setExploreTab, setNetworkTab, openDetail } = useWorkspace();

  function start() {
    running.current?.destroy();
    const source = state.network.scope === "month" ? monthIndicators : indicators;
    const first = source[0] ?? null;
    const steps = buildGuideSteps({
      datasetLoaded: dataset != null,
      synthetic: dataset?.synthetic === true,
      periodLabel: dataset?.periodLabel ?? null,
      deviceCount: dataset?.names.length ?? null,
      connectionCount: source.length,
      opportunityCount: findOpportunities(source).flagged.length,
      monthLoaded: month != null,
      censusMatched: census ? census.matched.length : null,
      censusAmbiguous: census ? census.ambiguous.length : null,
      censusUnmatched: census ? census.unmatchedCensus.length : null,
      exampleLabel: first ? `${first.origin.label} to ${first.destination.label}` : null,
    });
    const previous = {
      sidebar: state.sidebar,
      exploreTab: state.exploreTab,
      networkTab: state.networkTab,
      href: `${window.location.pathname}${window.location.search}`,
    };
    setPlaying(false);
    running.current = startTeamGuide(steps, {
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      prepare: (step) => prepareStep(step, router, { setSidebar, setExploreTab, setNetworkTab, openDetail }, first?.id ?? null),
      restore: ({ route }) => {
        setSidebar(previous.sidebar);
        setExploreTab(previous.exploreTab);
        setNetworkTab(previous.networkTab);
        if (!route) return;
        const here = `${window.location.pathname}${window.location.search}`;
        // Driver destroys the guide inside the click that left the last step. Replacing the route on that same turn is ignored.
        if (here !== previous.href) window.setTimeout(() => router.replace(previous.href), 0);
      },
    });
  }

  return (
    <button type="button" className="btn btn-ghost" onClick={start} aria-label="Team Guide">
      <CircleHelp size={16} aria-hidden />
      <span className="hidden sm:inline">Team Guide</span>
    </button>
  );
}

function prepareStep(
  step: GuideStep,
  router: { push: (href: string) => void },
  workspace: {
    setSidebar: (mode: "expanded" | "collapsed" | "hidden") => void;
    setExploreTab: (tab: "data" | "vessels" | "hubs") => void;
    setNetworkTab: (tab: "observed" | "opportunities" | "routes" | "frequency") => void;
    openDetail: (detail: { type: "connection"; id: string }) => void;
  },
  connectionId: string | null,
) {
  workspace.setSidebar("expanded");
  if (step.exploreTab) workspace.setExploreTab(step.exploreTab);
  if (step.networkTab) {
    workspace.setNetworkTab(step.networkTab);
    const query = step.networkTab === "observed" ? "" : `?tab=${step.networkTab}`;
    if (window.location.pathname === "/network") window.history.replaceState(window.history.state, "", `/network${query}`);
  }
  if (step.route && window.location.pathname !== step.route) {
    const href = step.route === "/network" && step.networkTab && step.networkTab !== "observed"
      ? `/network?tab=${step.networkTab}`
      : step.route;
    router.push(href);
  }
  if (step.openConnection && connectionId) workspace.openDetail({ type: "connection", id: connectionId });
}
