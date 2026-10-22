import { CONNECTIVITY } from "@/config/constants";
import {
  DISTANCE_BANDS,
  dayCountVariation,
  distanceBand,
  durationVariability,
  type ConnectionIndicator,
} from "@/lib/analytics/connectivity";
import { quantile } from "@/lib/analytics/stats";

export interface OpportunityRule {
  id: "variable" | "slow" | "indirect" | "inconsistent" | "gaps";
  title: string;
  detail: string;
  question: string;
}

export interface Opportunity {
  indicator: ConnectionIndicator;
  rules: OpportunityRule[];
  caveats: string[];
}

export interface OpportunityThresholds {
  variabilityRatio: number;
  slowRatio: number;
  pathRatio: number;
  dayCv: number;
  gapShare: number;
}

export const DEFAULT_OPPORTUNITY_THRESHOLDS: OpportunityThresholds = {
  variabilityRatio: CONNECTIVITY.variabilityRatio,
  slowRatio: CONNECTIVITY.slowRatio,
  pathRatio: CONNECTIVITY.pathRatio,
  dayCv: CONNECTIVITY.dayCv,
  gapShare: CONNECTIVITY.gapShare,
};

function minutesPerKm(indicator: ConnectionIndicator): number | null {
  if (indicator.medianDurationMs == null || indicator.medianDistanceM == null || indicator.medianDistanceM < 1_000) return null;
  return indicator.medianDurationMs / 60_000 / (indicator.medianDistanceM / 1_000);
}

function bandBaseline(indicators: readonly ConnectionIndicator[]): Map<number, number> {
  const groups = new Map<number, number[]>();
  for (const indicator of indicators) {
    if (indicator.evidence !== "adequate") continue;
    const pace = minutesPerKm(indicator);
    if (pace == null || indicator.medianDistanceM == null) continue;
    const band = distanceBand(indicator.medianDistanceM);
    const list = groups.get(band);
    if (list) list.push(pace);
    else groups.set(band, [pace]);
  }
  const baselines = new Map<number, number>();
  for (const [band, paces] of groups) {
    if (paces.length < CONNECTIVITY.minBandComparisons) continue;
    const mid = quantile(paces, 0.5);
    if (mid != null) baselines.set(band, mid);
  }
  return baselines;
}

/**
 * Ranks only connections with adequate evidence. Each flag is a separate rule
 * with its threshold. There is no combined score.
 */
export function findOpportunities(
  indicators: readonly ConnectionIndicator[],
  thresholds: OpportunityThresholds = DEFAULT_OPPORTUNITY_THRESHOLDS,
): { flagged: Opportunity[]; withheld: ConnectionIndicator[] } {
  const baselines = bandBaseline(indicators);
  const flagged: Opportunity[] = [];
  const withheld: ConnectionIndicator[] = [];

  for (const indicator of indicators) {
    if (indicator.evidence !== "adequate") {
      withheld.push(indicator);
      continue;
    }
    const rules: OpportunityRule[] = [];
    const variability = durationVariability(indicator);
    if (
      variability != null &&
      indicator.passages >= CONNECTIVITY.minPassagesForVariability &&
      variability >= thresholds.variabilityRatio
    ) {
      rules.push({
        id: "variable",
        title: "Journey times vary widely",
        detail: `The middle half of journeys spans ${Math.round(variability * 100)}% of the typical time. The rule flags ${Math.round(thresholds.variabilityRatio * 100)}% or more, from at least ${CONNECTIVITY.minPassagesForVariability} journeys.`,
        question: "What differs between the shorter and longer observed journeys on this connection?",
      });
    }
    const pace = minutesPerKm(indicator);
    const band = indicator.medianDistanceM == null ? null : distanceBand(indicator.medianDistanceM);
    const baseline = band == null ? null : baselines.get(band);
    if (pace != null && baseline != null && indicator.passages >= CONNECTIVITY.minPassagesForVariability && pace >= baseline * thresholds.slowRatio) {
      rules.push({
        id: "slow",
        title: "Journeys take longer than similar distances",
        detail: `Typical pace is ${pace.toFixed(1)} min/km. The middle of adequate connections in the ${DISTANCE_BANDS[band ?? 0]} band is ${baseline.toFixed(1)} min/km. The rule flags ${thresholds.slowRatio}× that pace or more.`,
        question: "Is the extra time spent moving, waiting, or untracked?",
      });
    }
    if (
      indicator.medianPathRatio != null &&
      indicator.passages >= CONNECTIVITY.minPassagesForPath &&
      indicator.medianPathRatio >= thresholds.pathRatio
    ) {
      rules.push({
        id: "indirect",
        title: "Tracked movement is much longer than the straight-line separation",
        detail: `The typical tracked path is ${indicator.medianPathRatio.toFixed(1)}× the straight-line separation. The rule flags ${thresholds.pathRatio}× or more. A straight line is not a navigable route.`,
        question: "Do these vessels follow a long channel, stop along the way, or lose GPS between the ends?",
      });
    }
    const dayCv = dayCountVariation(indicator);
    if (dayCv != null && dayCv >= thresholds.dayCv) {
      rules.push({
        id: "inconsistent",
        title: "Observed activity changes sharply across days",
        detail: `Daily journey counts vary with a coefficient of variation of ${dayCv.toFixed(1)} across ${indicator.dayCounts.length} observation days, including days with none. The rule flags ${thresholds.dayCv} or more.`,
        question: "Which days carry the observed passages, and is the tracker present on the quiet days?",
      });
    }
    const attempts = indicator.passages + indicator.excluded;
    const gapShare = attempts === 0 ? 0 : indicator.excluded / attempts;
    if (attempts >= CONNECTIVITY.minAttemptsForGaps && gapShare >= thresholds.gapShare) {
      rules.push({
        id: "gaps",
        title: "A large share of passages lack usable tracking",
        detail: `${indicator.excluded} of ${attempts} passages were kept out of the typical time because of a coverage gap or a long hole in the track. The rule flags ${Math.round(thresholds.gapShare * 100)}% or more.`,
        question: "Is the missing track a GPS gap, or time spent outside the watched movement?",
      });
    }
    if (rules.length === 0) continue;
    flagged.push({
      indicator,
      rules,
      caveats: [
        "A flag is a reason to look, not a finding that the connection is inefficient or unserved.",
        "A long or uneven journey can come from weather, vessel type, cargo handling, waiting, or gaps in the tracker.",
        "Tracked vessels are not the whole fleet. Absence of a passage is not evidence that no service exists.",
      ],
    });
  }

  flagged.sort((a, b) => b.rules.length - a.rules.length || b.indicator.passages - a.indicator.passages || a.indicator.id.localeCompare(b.indicator.id));
  return { flagged, withheld };
}
