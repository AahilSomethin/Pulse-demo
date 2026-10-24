import { ANOMALY, CONNECTIVITY } from "@/config/constants";
import {
  DISTANCE_BANDS,
  dayCountVariation,
  distanceBand,
  durationVariability,
  type ConnectionIndicator,
} from "@/lib/analytics/connectivity";
import type { PassageFlagSummary } from "@/lib/analytics/anomalies";
import { quantile } from "@/lib/analytics/stats";

export interface OpportunityRule {
  id: "variable" | "slow" | "indirect" | "inconsistent" | "gaps" | "unusual_passages";
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

const PASSAGE_CAVEAT = "An unusual time is a reason to replay the track. It is not a confirmed delay, a tracking fault, or an incident on its own.";

/** Plain-language rule for journeys that clear both the robust score and the quartile fence. */
export function unusualPassageRule(summary: PassageFlagSummary): OpportunityRule | null {
  if (summary.outliers < ANOMALY.minOutliers) return null;
  const where = summary.baseline === "august_summary"
    ? `the August summary (${summary.cohortPassages} journeys, ${summary.cohortVessels} vessels)`
    : `this loaded day (${summary.cohortPassages} journeys, ${summary.cohortVessels} vessels)`;
  const movement = summary.movementKnown
    ? `${summary.stationary} barely moved, ${summary.slowDirect} stayed direct but much slower than usual, ${summary.longDetour} took a much longer tracked path, and ${summary.unusuallyLong} were long without one of those patterns.`
    : "The August summary stores journey times, not each path, so this count cannot yet say whether the vessel was stopped or still moving.";
  return {
    id: "unusual_passages",
    title: "Some journeys took much longer than usual",
    detail: `${summary.outliers} journeys were far above both the typical time and the normal spread. ${movement} Compared with ${where}.`,
    question: summary.movementKnown
      ? "Open the connection, read one journey, and replay it. Check whether the extra time was a stop, a slower vessel, or a gap in the track."
      : "Load that day in Explore and replay a journey before treating the long time as real travel.",
  };
}

/**
 * Ranks connections with adequate evidence. A connection can also be listed
 * when individual journeys are far outside a large enough cohort. Each flag
 * is a separate rule. There is no combined score.
 */
export function findOpportunities(
  indicators: readonly ConnectionIndicator[],
  thresholds: OpportunityThresholds = DEFAULT_OPPORTUNITY_THRESHOLDS,
  passageFlags: ReadonlyMap<string, PassageFlagSummary> = new Map(),
): { flagged: Opportunity[]; withheld: ConnectionIndicator[] } {
  const baselines = bandBaseline(indicators);
  const flagged: Opportunity[] = [];
  const withheld: ConnectionIndicator[] = [];

  for (const indicator of indicators) {
    const summary = passageFlags.get(indicator.id);
    const passageRule = summary ? unusualPassageRule(summary) : null;
    if (indicator.evidence !== "adequate") {
      if (passageRule) {
        flagged.push({
          indicator,
          rules: [passageRule],
          caveats: [
            "A flag is a reason to look, not a finding that the connection is inefficient or unserved.",
            PASSAGE_CAVEAT,
          ],
        });
      } else withheld.push(indicator);
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
    if (passageRule) rules.push(passageRule);
    if (rules.length === 0) continue;
    const caveats = [
      "A flag is a reason to look, not a finding that the connection is inefficient or unserved.",
      "A long or uneven journey can come from weather, vessel type, cargo handling, waiting, or gaps in the tracker.",
      "Tracked vessels are not the whole fleet. Absence of a passage is not evidence that no service exists.",
    ];
    if (passageRule) caveats.push(PASSAGE_CAVEAT);
    flagged.push({ indicator, rules, caveats });
  }

  flagged.sort((a, b) => b.rules.length - a.rules.length || b.indicator.passages - a.indicator.passages || a.indicator.id.localeCompare(b.indicator.id));
  return { flagged, withheld };
}
