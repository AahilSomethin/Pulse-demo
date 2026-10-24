"use client";

import { useMemo } from "react";

import {
  cohortFromIndicator,
  findPassageOutliers,
  summariesFromDurations,
  type PassageFlagSummary,
  type PassageReview,
} from "@/lib/analytics/anomalies";
import { useDataset } from "@/context/MaritimeContext";
import { useWorkspace } from "@/context/WorkspaceContext";

export interface PassageReviewState {
  day: PassageReview;
  month: Map<string, PassageFlagSummary>;
  /** Summaries for the window currently selected in Network. */
  summaries: Map<string, PassageFlagSummary>;
}

export function usePassageReview(): PassageReviewState {
  const { journeys, monthIndicators } = useDataset();
  const { state } = useWorkspace();
  const scope = state.network.scope;
  return useMemo(() => {
    const cohorts = monthIndicators.flatMap((indicator) => {
      const cohort = cohortFromIndicator(indicator);
      return cohort ? [cohort] : [];
    });
    const day = findPassageOutliers(journeys, cohorts);
    const month = summariesFromDurations(monthIndicators);
    return { day, month, summaries: scope === "month" ? month : day.summaries };
  }, [journeys, monthIndicators, scope]);
}
