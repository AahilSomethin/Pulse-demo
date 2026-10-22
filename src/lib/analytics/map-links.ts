import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import type { MapLine, MapLocation } from "@/types/map";

/** How many unselected overview lines to draw, and how many may share one endpoint. */
export function connectionRankBudget(zoom: number): { lines: number; perEndpoint: number } {
  if (zoom < 6) return { lines: 6, perEndpoint: 2 };
  if (zoom < 8) return { lines: 10, perEndpoint: 2 };
  if (zoom < 10) return { lines: 16, perEndpoint: 3 };
  if (zoom < 12) return { lines: 22, perEndpoint: 4 };
  return { lines: 32, perEndpoint: 6 };
}

/**
 * Lines to put on the map.
 * Overview mode keeps every record in the published overlay and draws a zoom-limited subset.
 * Opportunity and Route Lab already pass only the lines that should appear.
 */
export function visibleConnectionLines(lines: readonly MapLine[], zoom: number): MapLine[] {
  if (!lines.some((line) => line.gated === 1)) return [...lines];
  const { lines: budget, perEndpoint } = connectionRankBudget(zoom);
  const ranked = [...lines].sort((a, b) => Number(b.active) - Number(a.active) || (a.rank ?? 0) - (b.rank ?? 0) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  const kept: MapLine[] = [];
  let quiet = 0;
  for (const line of ranked) {
    if (line.kind === "response" || line.gated !== 1 || line.active) {
      kept.push(line);
      continue;
    }
    const ends = line.coordinates.slice(0, 2).map(([lon, lat]) => `${lon.toFixed(2)},${lat.toFixed(2)}`);
    const crowded = ends.some((end) => (counts.get(end) ?? 0) >= perEndpoint);
    if (quiet >= budget || crowded) continue;
    kept.push(line);
    quiet += 1;
    for (const end of ends) counts.set(end, (counts.get(end) ?? 0) + 1);
  }
  return kept;
}

export type ConnectionMapMode = "overview" | "opportunity" | "selected";

/**
 * Map drawing for connections that already exist.
 * Overview publishes every indicator. The map then draws a zoom-limited subset.
 * Opportunity and Route Lab receive only the lines that should be on the map.
 */
export function connectionOverlay(
  indicators: readonly ConnectionIndicator[],
  activeId: string | null,
  mode: ConnectionMapMode = "overview",
) {
  const ranked = [...indicators].sort((a, b) => b.passages - a.passages || a.id.localeCompare(b.id));
  const lines: MapLine[] = ranked.map((indicator, rank) => {
    const active = indicator.id === activeId;
    const named = indicator.origin.confidence !== "inferred" || indicator.destination.confidence !== "inferred";
    return {
      id: indicator.id,
      kind: named ? "named" as const : "inferred" as const,
      coordinates: [
        [indicator.origin.lon, indicator.origin.lat],
        [indicator.destination.lon, indicator.destination.lat],
      ],
      active,
      weight: 0.35,
      offset: indicator.origin.id < indicator.destination.id ? 2 : -2,
      opacity: mode === "overview" ? 0.55 : active ? 0.95 : 0.12,
      rank,
      gated: mode === "overview" ? 1 : 0,
    };
  });

  const located = mode === "overview"
    ? ranked.filter((indicator, index) => index < 12 || indicator.id === activeId)
    : ranked.filter((indicator) => indicator.id === activeId);
  const locations = new Map<string, MapLocation>();
  for (const indicator of located) {
    for (const end of [indicator.origin, indicator.destination]) {
      const existing = locations.get(end.id);
      if (existing) existing.passages += indicator.passages;
      else locations.set(end.id, { id: end.id, lon: end.lon, lat: end.lat, label: end.label, passages: indicator.passages });
    }
  }
  return { lines, locations: [...locations.values()], hidden: 0, mode };
}
