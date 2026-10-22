"use client";

import { Layers, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";

import { SeaMap } from "@/components/map/SeaMap";
import { MapLegend, MapStatus, Notice } from "@/components/ui/Metrics";
import { useDataset, usePlaybackClock, usePlaybackSettings } from "@/context/MaritimeContext";
import { useTheme } from "@/context/ThemeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { MAP_CENTER } from "@/config/constants";
import { boundsCenter, ringBounds, unionBounds } from "@/lib/geo/bounds";
import { ATOLL_CODES, ATOLL_TITLES } from "@/lib/reference/atolls";
import { getMapOverlay, getServerMapOverlay, subscribeMapOverlay } from "@/lib/workspace/overlay";
import type { MapLayerVisibility } from "@/types/map";

const LAYER_ITEMS: { key: keyof MapLayerVisibility; label: string }[] = [
  { key: "hubs", label: "Activity hubs" },
  { key: "vessels", label: "Vessel dots" },
  { key: "trail", label: "Selected trail" },
  { key: "islands", label: "Islands" },
  { key: "connections", label: "Inferred connections" },
  { key: "scenario", label: "Scenario overlays" },
];

export function MapStage() {
  const pathname = usePathname();
  const { dataset, geography, month, loading, loadingLabel, error } = useDataset();
  const { frame } = usePlaybackClock();
  const { selected, cellDeg, setSelected } = usePlaybackSettings();
  const { theme } = useTheme();
  const { state, openDetail, toggleLayer, setSidebar, reopenDetail, focusOn, setPick } = useWorkspace();
  const overlay = useSyncExternalStore(subscribeMapOverlay, getMapOverlay, getServerMapOverlay);
  const [layersOpen, setLayersOpen] = useState(false);
  const [atollChoice, setAtollChoice] = useState("");
  const section = pathname === "/network" ? "network" : pathname === "/simulate" ? "simulate" : "explore";
  const selectedHubId = state.detail?.type === "hub" ? `${state.detail.fx}:${state.detail.fy}` : null;
  const detail = state.detail;
  const selectedIslandId = detail?.type === "location" && geography?.polygons.some((polygon) => polygon.id === detail.id) ? detail.id : null;
  const atollCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const polygon of geography?.polygons ?? []) {
      if (!polygon.atoll || polygon.synthetic) continue;
      counts.set(polygon.atoll, (counts.get(polygon.atoll) ?? 0) + 1);
    }
    return counts;
  }, [geography]);

  const legend = [
    ...(state.layers.hubs ? [{ swatch: "bg-hub", label: "Activity hubs", pattern: "dot" as const }] : []),
    ...(state.layers.vessels ? [{ swatch: "bg-vessel", label: "Vessel reports", pattern: "dot" as const }] : []),
    ...(state.layers.trail ? [{ swatch: "bg-ocean", label: "Historical track", pattern: "solid" as const }] : []),
    ...(state.layers.connections && section === "network" ? [
      { swatch: "bg-cyan", label: "Inferred connection", pattern: "dashed" as const },
      { swatch: "bg-cyan", label: "Named places", pattern: "solid" as const },
    ] : []),
    ...(state.layers.scenario && section === "simulate" ? [
      { swatch: "bg-danger", label: "Hypothetical incident", pattern: "dot" as const },
      { swatch: "bg-warning", label: "Assumed origin", pattern: "dot" as const },
      { swatch: "bg-danger", label: "Estimated response", pattern: "dashed" as const },
    ] : []),
  ];

  return (
    <div className="no-print absolute inset-0" data-tour="map">
      <SeaMap
        dataset={dataset}
        polygons={geography?.polygons ?? []}
        facilities={geography?.facilities ?? []}
        frame={frame}
        selected={selected}
        layers={state.layers}
        cellDeg={cellDeg}
        theme={theme}
        clickMode={overlay.clickMode}
        markers={state.pick ? [...overlay.markers, { id: "search-pick", lon: state.pick.lon, lat: state.pick.lat, kind: "route", label: state.pick.label }] : overlay.markers}
        lines={overlay.lines}
        locations={overlay.locations ?? []}
        selectedHubId={selectedHubId}
        selectedIslandId={selectedIslandId}
        focus={state.focus}
        onSelectDevice={(device) => {
          setSelected(device);
          openDetail({ type: "vessel", device });
        }}
        onSelectHub={(hub) => openDetail({ type: "hub", fx: hub.fx, fy: hub.fy })}
        onSelectLocation={(id) => openDetail({ type: "location", id })}
        onPlace={overlay.onPlace}
      />
      <MapStatus label={loading ? loadingLabel : null} />
      {!dataset && !month && !loading && overlay.lines.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm text-fg-muted">
          Load a daily FollowMe CSV from Explore. Columns used: imei, device_date, latitude, longitude, and speed.
        </div>
      ) : null}
      {error ? (
        <div className="absolute top-3 left-14 z-10 max-w-sm">
          <Notice tone="warning">{error}</Notice>
        </div>
      ) : null}
      {!state.presenting ? (
        <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2" data-tour="map-extent">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPick(null);
                focusOn(MAP_CENTER.longitude, MAP_CENTER.latitude, { zoom: MAP_CENTER.zoom });
              }}
            >
              Maldives
            </button>
            <label className="field">
              <span className="sr-only">Atoll view</span>
              <select
                value={atollChoice}
                onChange={(event) => {
                  const code = event.target.value;
                  setAtollChoice("");
                  const polygons = (geography?.polygons ?? []).filter((polygon) => polygon.atoll === code && !polygon.synthetic);
                  const bounds = unionBounds(polygons.map((polygon) => ringBounds(polygon.rings)));
                  if (!bounds) return;
                  const center = boundsCenter(bounds);
                  setPick(null);
                  focusOn(center.lon, center.lat, { bounds });
                }}
              >
                <option value="">Atoll</option>
                {ATOLL_CODES.map((code) => {
                  const count = atollCounts.get(code) ?? 0;
                  return <option key={code} value={code} disabled={count === 0}>{ATOLL_TITLES[code]}{count === 0 ? " (no geometry)" : ""}</option>;
                })}
              </select>
            </label>
          </div>
          <button type="button" className="btn" aria-expanded={layersOpen} aria-controls="map-layers" onClick={() => setLayersOpen((current) => !current)}>
            <Layers size={16} aria-hidden />
            Layers
          </button>
          {layersOpen ? (
            <fieldset id="map-layers" className="w-56 rounded-lg border border-border bg-surface p-3 text-sm shadow-panel">
              <legend className="px-1 text-xs text-fg-muted">Map layers</legend>
              <div className="flex flex-col gap-2">
                {LAYER_ITEMS.map((item) => (
                  <label key={item.key} className="flex items-center gap-2">
                    <input type="checkbox" checked={state.layers[item.key]} onChange={() => toggleLayer(item.key)} />
                    {item.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {state.detail && !state.detailsOpen ? (
            <button type="button" className="btn" onClick={reopenDetail}>Show details</button>
          ) : null}
        </div>
      ) : null}
      {state.sidebar === "hidden" && !state.presenting ? (
        <button type="button" className="btn absolute top-16 left-3 z-10" onClick={() => setSidebar("expanded")}>
          <PanelLeftOpen size={16} aria-hidden />
          Show panel
        </button>
      ) : null}
      {legend.length > 0 ? <MapLegend items={legend} note="Named OpenStreetMap islands and islets in the reference file. Not a complete official list." /> : <MapLegend items={[]} note="Named OpenStreetMap islands and islets in the reference file. Not a complete official list." />}
    </div>
  );
}
