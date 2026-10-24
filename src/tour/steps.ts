export interface GuideSnapshot {
  datasetLoaded: boolean;
  synthetic: boolean;
  periodLabel: string | null;
  deviceCount: number | null;
  connectionCount: number;
  opportunityCount: number;
  monthLoaded: boolean;
  censusMatched: number | null;
  censusAmbiguous: number | null;
  censusUnmatched: number | null;
  exampleLabel: string | null;
}

export interface GuideStep {
  id: string;
  title: string;
  description: string;
  fallbackDescription: string;
  /** `data-tour` value. Null means a centred explanation. */
  target: string | null;
  route: "/explore" | "/network" | "/simulate" | null;
  exploreTab: "data" | null;
  networkTab: "observed" | "opportunities" | "routes" | "frequency" | null;
  openConnection: boolean;
  disableMap: boolean;
}

const EMPTY: GuideSnapshot = {
  datasetLoaded: false,
  synthetic: false,
  periodLabel: null,
  deviceCount: null,
  connectionCount: 0,
  opportunityCount: 0,
  monthLoaded: false,
  censusMatched: null,
  censusAmbiguous: null,
  censusUnmatched: null,
  exampleLabel: null,
};

function dataCopy(snapshot: GuideSnapshot): string {
  const session = !snapshot.datasetLoaded
    ? "No FollowMe day is loaded. Use this panel to load one, or switch Network to the August summary when that file is on this computer."
    : snapshot.synthetic
      ? `This session is synthetic test data (${snapshot.deviceCount ?? 0} devices), not a maritime finding.`
      : `This session has ${snapshot.deviceCount ?? 0} tracked devices from ${snapshot.periodLabel ?? "the loaded file"}.`;
  const month = snapshot.monthLoaded ? " The August summary is loaded on this computer." : "";
  const census = snapshot.censusMatched == null
    ? "Census 2022 is not loaded, so resident population is not shown."
    : `Census 2022 matched ${snapshot.censusMatched} reference islands. A match is by official code, by atoll and name, or by a unique name, and the profile says which. ${snapshot.censusAmbiguous ?? 0} are ambiguous and ${snapshot.censusUnmatched ?? 0} census islands are unmatched. Unmatched places stay blank.`;
  return `The evidence is historical GPS from tracked devices in the August 2025 FollowMe extract, plus OpenStreetMap islands and harbours. It is not a live vessel feed. ${session}${month} ${census}`;
}

function opportunityCopy(snapshot: GuideSnapshot): string {
  if (snapshot.connectionCount === 0) {
    return "Find opportunities checks loaded connections for unusual travel times, uneven activity across days, or thin evidence. Nothing is loaded in the current window, so there is nothing to flag. A flag is an investigation candidate, not proof that a service failed.";
  }
  return `Find opportunities opens Review first for the ${snapshot.connectionCount} connections in this window. It shows up to three unusual journeys from the loaded day, with the usual time beside each one. Investigate replays one on the map. ${snapshot.opportunityCount} connections also meet another investigation rule, under all findings. A flag is a question for a planner, not proof that a service failed.`;
}

function profileCopy(snapshot: GuideSnapshot): { description: string; fallback: string; target: string | null } {
  const fallback = "A connectivity profile opens when you select a connection. It shows journey count, distinct vessels, typical travel time, how much those times vary, and an evidence label. No connection is available in the current window.";
  if (snapshot.connectionCount === 0 || !snapshot.exampleLabel) {
    return { description: fallback, fallback, target: null };
  }
  const prefix = snapshot.synthetic ? "The open profile uses synthetic test data" : "The open profile is one observed connection";
  return {
    description: `${prefix}: ${snapshot.exampleLabel}. It reports how often the journey appears, how many distinct vessels made it, the typical travel time, how much those times vary, and whether the evidence is enough to compare.`,
    fallback,
    target: "details",
  };
}

/** Team-guide steps. Counts come only from the snapshot captured when the guide starts. */
export function buildGuideSteps(snapshot: GuideSnapshot = EMPTY): GuideStep[] {
  const profile = profileCopy(snapshot);
  const playbackReady = snapshot.datasetLoaded;
  return [
    {
      id: "why",
      title: "Why SeaPulse?",
      description: "Boat journeys connect communities across the Maldives, but raw tracking records do not show which crossings are frequent, how consistent the travel times are, or which patterns deserve further investigation. SeaPulse turns those observations into connectivity evidence.",
      fallbackDescription: "Boat journeys connect communities across the Maldives, but raw tracking records do not show which crossings are frequent, how consistent the travel times are, or which patterns deserve further investigation. SeaPulse turns those observations into connectivity evidence.",
      target: null,
      route: null,
      exploreTab: null,
      networkTab: null,
      openConnection: false,
      disableMap: false,
    },
    {
      id: "data",
      title: "Our data",
      description: dataCopy(snapshot),
      fallbackDescription: "FollowMe days are loaded from this Explore panel. The guide can continue without a file: nothing is invented when a day or the August summary is missing.",
      target: "explore-data",
      route: "/explore",
      exploreTab: "data",
      networkTab: null,
      openConnection: false,
      disableMap: false,
    },
    {
      id: "explore",
      title: "Explore",
      description: "Each marker is a historical GPS report from a tracked device, not a live position. Activity cells count distinct tracked vessels in the selected time window. Brighter cells mean more observed activity. They are not confirmed ports.",
      fallbackDescription: "The map shows historical GPS reports once a FollowMe day is loaded. Activity cells count tracked vessels in the time window. They are not confirmed ports.",
      target: "map",
      route: "/explore",
      exploreTab: null,
      networkTab: null,
      openConnection: false,
      disableMap: true,
    },
    {
      id: "playback",
      title: "Playback",
      description: playbackReady
        ? "Playback moves through the loaded day. The window shows which reports fall in the selected span. A faster playback speed advances the timeline. It does not change a vessel's recorded speed."
        : "Playback appears under the map after a day loads. It moves through that day's reports. Playback speed advances the timeline. It does not change a vessel's recorded speed.",
      fallbackDescription: "Playback appears under the map after a day loads. It moves through that day's reports. Playback speed advances the timeline. It does not change a vessel's recorded speed.",
      target: playbackReady ? "playback" : null,
      route: "/explore",
      exploreTab: null,
      networkTab: null,
      openConnection: false,
      disableMap: false,
    },
    {
      id: "search",
      title: "Search",
      description: "Search is in the header. It finds islands by English or Dhivehi name, atolls, OpenStreetMap harbour points, inferred activity areas, and a vessel from the loaded day. Vessel results stay masked, and an empty search does not list device identifiers. Choosing an island frames it and opens its connectivity profile. Choosing a vessel shows that device's historical track. Maldives returns to a nationwide view. Atoll zoom works only where this reference file has geometry.",
      fallbackDescription: "Search is in the header. It finds islands, atolls, harbour reference points, inferred activity areas, and a vessel from a loaded day. Vessel identifiers stay masked. Island coverage is the OpenStreetMap file, not a complete official list.",
      target: "global-search",
      route: null,
      exploreTab: null,
      networkTab: null,
      openConnection: false,
      disableMap: false,
    },
    {
      id: "network",
      title: "Network",
      description: snapshot.connectionCount === 0
        ? "Network turns stops into observed connections, with journey counts, typical travel times, and an evidence label. The current window has no connections yet. Switch between the loaded day and the August summary here when either is available. A missing line is not proof that no boat sailed."
        : `Network turns stops into observed connections. The current window has ${snapshot.connectionCount} connections, with journey counts, typical travel times, and an evidence label. A missing line is not proof that no boat sailed.`,
      fallbackDescription: "Open Network to see observed connections. If the panel is hidden, expand it from the map. A missing line is not proof that no boat sailed.",
      target: "network-scope",
      route: "/network",
      exploreTab: null,
      networkTab: "observed",
      openConnection: false,
      disableMap: false,
    },
    {
      id: "profile",
      title: "Connectivity profile",
      description: profile.description,
      fallbackDescription: profile.fallback,
      target: profile.target,
      route: "/network",
      exploreTab: null,
      networkTab: null,
      openConnection: profile.target === "details",
      disableMap: false,
    },
    {
      id: "frequency",
      title: "Vessel frequency",
      description: "Frequency summarises observed passages, distinct tracked vessels when the loaded day can de-duplicate them, active days, and journey times. A day range changes passage counts only. It does not rebuild typical times from a month total. These figures are tracked movements, not a scheduled ferry timetable.",
      fallbackDescription: "Frequency is a Network tab. It summarises observed passages in the current window. It is not a ferry timetable, and GPS pings are not vessel visits.",
      target: "network-tab-frequency",
      route: "/network",
      exploreTab: null,
      networkTab: "frequency",
      openConnection: false,
      disableMap: false,
    },
    {
      id: "opportunities",
      title: "Find opportunities",
      description: opportunityCopy(snapshot),
      fallbackDescription: "Find opportunities is the primary action in Network. It lists investigation candidates from the loaded window, including journeys that took much longer than usual, and holds back connections that do not have enough repeated journeys. Nothing is loaded, so there is nothing to flag.",
      target: "find-opportunities",
      route: "/network",
      exploreTab: null,
      networkTab: "opportunities",
      openConnection: false,
      disableMap: false,
    },
    {
      id: "routes",
      title: "Route Lab",
      description: "Route Lab compares the observed typical travel time with a duration you type. The difference is a scenario estimate. It is not a guaranteed saving, and a straight line is not a channel.",
      fallbackDescription: "Route Lab sits on this tab. It needs an observed connection before it can compare a typed duration with the historical typical time.",
      target: "network-tab-routes",
      route: "/network",
      exploreTab: null,
      networkTab: "routes",
      openConnection: false,
      disableMap: false,
    },
    {
      id: "report",
      title: "Connectivity report",
      description: "Export CSV or print the frequency view for the current filters. The file includes the period, method, evidence rules, unusual-journey counts, and limitations. It omits coordinates, device identifiers, and trajectories.",
      fallbackDescription: "The frequency view can export a CSV or a printed summary of the current filters, including how many journeys were far outside the usual time. Coordinates and device identifiers are left out.",
      target: "network-report",
      route: "/network",
      exploreTab: null,
      networkTab: "frequency",
      openConnection: false,
      disableMap: false,
    },
    {
      id: "limits",
      title: "Limitations and impact",
      description: "FollowMe covers tracked devices, not every vessel and not a ferry timetable. A gap in the record does not prove a gap in service. Inferred activity areas are not verified islands or harbours. Census 2022 population is context for a matched island only, and SeaPulse does not score isolation. Emergency Simulation is in this Experimental menu. It is a supporting experiment that tries hypothetical response times from historical positions. It is not live rescue guidance. What a planner can do is see where the evidence is thin and decide where better information is needed.",
      fallbackDescription: "FollowMe covers tracked devices only. Missing observations do not prove missing services. Census 2022 is context for matched islands. Emergency Simulation, under Experimental, is a supporting experiment, not an operational tool.",
      target: "nav-experimental",
      route: null,
      exploreTab: null,
      networkTab: null,
      openConnection: false,
      disableMap: false,
    },
  ];
}
