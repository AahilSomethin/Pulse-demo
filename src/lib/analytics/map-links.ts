import type { ConnectionIndicator } from "@/lib/analytics/connectivity";
import type { MapLine, MapLocation } from "@/types/map";

export function connectionOverlay(indicators: readonly ConnectionIndicator[], activeId: string | null, cap: number) {
  const ranked = [...indicators].sort((a, b) => b.passages - a.passages || a.id.localeCompare(b.id));
  const shown = ranked.slice(0, cap);
  const max = shown[0]?.passages ?? 1;
  const lines: MapLine[] = shown.map((indicator) => {
    const named = indicator.origin.confidence !== "inferred" || indicator.destination.confidence !== "inferred";
    const opacity = indicator.evidence === "adequate" ? 0.9 : indicator.evidence === "limited" ? 0.6 : 0.35;
    return {
      id: indicator.id,
      kind: named ? "named" as const : "inferred" as const,
      coordinates: [
        [indicator.origin.lon, indicator.origin.lat],
        [indicator.destination.lon, indicator.destination.lat],
      ],
      active: indicator.id === activeId,
      weight: Math.log1p(indicator.passages) / Math.log1p(Math.max(max, 1)),
      offset: indicator.origin.id < indicator.destination.id ? 3 : -3,
      opacity,
    };
  });
  const locations = new Map<string, MapLocation>();
  for (const indicator of shown) {
    for (const end of [indicator.origin, indicator.destination]) {
      const existing = locations.get(end.id);
      if (existing) existing.passages += indicator.passages;
      else locations.set(end.id, { id: end.id, lon: end.lon, lat: end.lat, label: end.label, passages: indicator.passages });
    }
  }
  return { lines, locations: [...locations.values()], hidden: Math.max(0, ranked.length - shown.length) };
}
