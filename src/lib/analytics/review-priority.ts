import { ANOMALY } from "@/config/constants";
import type { OutlierKind, PassageOutlier } from "@/lib/analytics/anomalies";

/**
 * How a flagged journey should be read.
 * `investigate` — long or slow movement with a large enough cohort and usable tracking.
 * `data_issue` — the extra time is likely a stop the dwell rule missed, a reporting hole, or a thin track.
 * `insufficient` — the time is ordinary for this device, so it is not promoted as a one-off.
 * None of these is a probability of an accident or dangerous behaviour.
 */
export type ReviewTier = "investigate" | "data_issue" | "insufficient";

export interface RankedFinding {
  outlier: PassageOutlier;
  tier: ReviewTier;
  notes: string[];
}

const GAP_HOLE_MS = 10 * 60 * 1000;
const GAP_SHARE = 0.4;
const THIN_PINGS = 4;
const OWN_PACE_RATIO = 1.5;
/** A tracked path this many times the straight-line separation is treated as a wandering trace. */
const EXTREME_PATH_RATIO = 6;

export function findingTitle(kind: OutlierKind): string {
  if (kind === "stationary") return "Unexpected stop";
  if (kind === "slow_direct") return "Unusually slow journey";
  if (kind === "long_detour") return "Unusually long track";
  return "Unusually long journey";
}

export function plainWhy(outlier: PassageOutlier): string {
  if (outlier.kind === "stationary") {
    return "The clock ran much longer than usual while the vessel barely moved.";
  }
  if (outlier.kind === "slow_direct") {
    return "The vessel stayed near a direct path, but the trip took much longer than other journeys on this connection.";
  }
  if (outlier.kind === "long_detour") {
    return "The tracked path is much longer than the straight-line separation, and the trip took much longer than usual.";
  }
  return "The trip took much longer than usual, and the extra time is not a near-stop or a much longer path.";
}

function reportingHole(outlier: PassageOutlier): boolean {
  if (!(outlier.durationMs > 0)) return true;
  return outlier.maxGapMs >= GAP_HOLE_MS && outlier.maxGapMs / outlier.durationMs >= GAP_SHARE;
}

/**
 * Separates a statistical flag into a tier. The robust score and quartile fence
 * are already applied. This step only asks whether the track and the device's
 * own journeys support reading it as unusual movement.
 */
export function classifyOutlier(outlier: PassageOutlier): { tier: ReviewTier; notes: string[] } {
  if (outlier.cohortPassages < ANOMALY.minPassages || outlier.cohortVessels < ANOMALY.minVessels) {
    return {
      tier: "insufficient",
      notes: ["This comparison does not have enough repeated journeys from different vessels."],
    };
  }
  if (reportingHole(outlier)) {
    return {
      tier: "data_issue",
      notes: ["A long hole in the reports covers much of the journey, so the extra time may be missing positions."],
    };
  }
  if (outlier.kind === "stationary") {
    return {
      tier: "data_issue",
      notes: ["The vessel barely moved, so this may be waiting, mooring, or a stop the dwell rule missed rather than a journey."],
    };
  }
  if (outlier.pathRatio >= EXTREME_PATH_RATIO) {
    return {
      tier: "data_issue",
      notes: ["The tracked path is many times the straight-line separation. That pattern often comes from a wandering GPS trace."],
    };
  }
  if (outlier.pingsBetween < THIN_PINGS) {
    return {
      tier: "data_issue",
      notes: ["Too few positions were recorded to trust the path. The long time may be a reconstruction gap."],
    };
  }
  if (
    outlier.deviceMedianMs != null &&
    outlier.deviceMedianMs > 0 &&
    outlier.durationMs <= outlier.deviceMedianMs * OWN_PACE_RATIO
  ) {
    return {
      tier: "insufficient",
      notes: ["This device’s own journeys on this connection are already about this long, so it is not a one-off for that vessel."],
    };
  }
  const notes = [
    "The journey is much longer than the usual time, the comparison has enough journeys and vessels, and the track is continuous enough to replay.",
  ];
  if (outlier.deviceMedianMs != null && outlier.durationMs > outlier.deviceMedianMs * OWN_PACE_RATIO) {
    notes.push("It is also longer than this device’s own typical time on this connection.");
  }
  return { tier: "investigate", notes };
}

function deviceContrast(outlier: PassageOutlier): number {
  if (outlier.deviceMedianMs == null || !(outlier.deviceMedianMs > 0)) return 1;
  return outlier.durationMs / outlier.deviceMedianMs;
}

function bestIn(items: RankedFinding[]): RankedFinding {
  return [...items].sort((a, b) => deviceContrast(b.outlier) - deviceContrast(a.outlier) || b.outlier.robustZ - a.outlier.robustZ)[0];
}

/**
 * Picks up to `limit` different connections. Order, with no combined score:
 * 1. A journey with a place name comes before a pair of unnamed activity cells.
 * 2. A connection with another unusual journey comes before a one-off.
 * 3. A journey that is also long for that same device comes before a higher robust score.
 * 4. The robust score breaks remaining ties.
 * Barely-moving passages and paths of 6× or more are not eligible.
 */
export function reviewFirst(outliers: readonly PassageOutlier[], limit = 3): RankedFinding[] {
  const grouped = new Map<string, RankedFinding[]>();
  for (const outlier of outliers) {
    const review = classifyOutlier(outlier);
    if (review.tier !== "investigate") continue;
    const row: RankedFinding = { outlier, tier: review.tier, notes: review.notes };
    const list = grouped.get(outlier.connectionId);
    if (list) list.push(row);
    else grouped.set(outlier.connectionId, [row]);
  }

  const connections = [...grouped.values()].sort((a, b) => {
    const left = bestIn(a);
    const right = bestIn(b);
    const named = Number(right.outlier.namedEnds > 0) - Number(left.outlier.namedEnds > 0);
    if (named !== 0) return named;
    const repeated = Number(b.length >= 2) - Number(a.length >= 2);
    if (repeated !== 0) return repeated;
    const contrast = deviceContrast(right.outlier) - deviceContrast(left.outlier);
    if (contrast !== 0) return contrast;
    return right.outlier.robustZ - left.outlier.robustZ;
  });

  const picks: RankedFinding[] = [];
  for (const items of connections) {
    if (picks.length >= limit) break;
    picks.push(bestIn(items));
  }
  return picks;
}

export function countReviewTiers(outliers: readonly PassageOutlier[]): Record<ReviewTier, number> {
  const tally: Record<ReviewTier, number> = { investigate: 0, data_issue: 0, insufficient: 0 };
  for (const outlier of outliers) tally[classifyOutlier(outlier).tier] += 1;
  return tally;
}
