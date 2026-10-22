import { durationVariability, type ConnectionIndicator } from "@/lib/analytics/connectivity";
import type { NetworkFilters } from "@/lib/workspace/state";

function geoClass(indicator: ConnectionIndicator): NetworkFilters["geoClass"] {
  const ends = [indicator.origin.confidence, indicator.destination.confidence];
  if (ends.includes("named_polygon")) return "named";
  if (ends.includes("near_harbour")) return "harbour";
  return "inferred";
}

export function filterIndicators(indicators: readonly ConnectionIndicator[], filters: NetworkFilters): ConnectionIndicator[] {
  return indicators.filter((indicator) => {
    if (indicator.passages < filters.minPassages) return false;
    if (filters.evidence === "adequate" && indicator.evidence !== "adequate") return false;
    if (filters.evidence === "limited" && indicator.evidence === "insufficient") return false;
    const minutes = indicator.medianDurationMs == null ? null : indicator.medianDurationMs / 60_000;
    if (filters.minDurationMin > 0 && (minutes == null || minutes < filters.minDurationMin)) return false;
    if (filters.maxDurationMin > 0 && (minutes == null || minutes > filters.maxDurationMin)) return false;
    if (filters.geoClass !== "all" && geoClass(indicator) !== filters.geoClass) return false;
    if (filters.minVariability > 0) {
      const variability = durationVariability(indicator);
      if (variability == null || variability < filters.minVariability) return false;
    }
    if (filters.atoll) {
      const atolls = [indicator.origin.atoll, indicator.destination.atoll];
      if (!atolls.includes(filters.atoll)) return false;
    }
    return true;
  });
}

export function atollOptions(indicators: readonly ConnectionIndicator[]): string[] {
  const names = new Set<string>();
  for (const indicator of indicators) {
    if (indicator.origin.atoll) names.add(indicator.origin.atoll);
    if (indicator.destination.atoll) names.add(indicator.destination.atoll);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
