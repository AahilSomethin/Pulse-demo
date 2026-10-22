"use client";

import { Layers, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { SeaMap } from "@/components/map/SeaMap";
import { MapLegend, MapStatus, Notice } from "@/components/ui/Metrics";
import { useDataset, usePlaybackClock, usePlaybackSettings } from "@/context/MaritimeContext";
import { useTheme } from "@/context/ThemeContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { getMapOverlay, getServerMapOverlay, subscribeMapOverlay } from "@/lib/workspace/overlay";
import type { MapLayerVisibility } from "@/types/map";

const LAYER_ITEMS: { key: keyof MapLayerVisibility; label: string }[] = [
  { key: "hubs", label: "Activity hubs" },
  { key: "vessels", label: "Vessel dots" },
  { key: "trail", label: "Selected trail" },
  { key: "islands", label: "Islands" },
  { key: "connections", label: "Observed connections" },
  { key: "scenario", label: "Scenario overlays" },
];

export function MapStage() {
  const pathname = usePathname();
  const { dataset, geography, loading, loadingLabel, error } = useDataset();
  const { frame } = usePlaybackClock();
  const { selected, cellDeg, setSelected } = usePlaybackSettings();
  const { theme } = useTheme();
  const { state, openDetail, toggleLayer, setSidebar, reopenDetail } = useWorkspace();
  const overlay = useSyncExternalStore(subscribeMapOverlay, getMapOverlay, getServerMapOverlay);
  const [layersOpen, setLayersOpen] = useState(false);
  const section = pathname === "/network" ? "network" : pathname === "/simulate" ? "simulate" : "explore";
  const selectedHubId = state.detail?.type === "hub" ? `${state.detail.fx}:${state.detail.fy}` : null;

  const legend = [
    ...(state.layers.hubs ? [{ swatch: "bg-ocean", label: "Activity hubs" }] : []),
    ...(state.layers.vessels ? [{ swatch: "bg-ocean", label: "Vessel reports" }] : []),
    ...(state.layers.trail ? [{ swatch: "bg-primary", label: "Selected trail" }] : []),
    ...(state.layers.connections && section === "network" ? [{ swatch: "bg-cyan", label: "Inferred connection" }, { swatch: "bg-primary", label: "Named polygon" }] : []),
    ...(state.layers.scenario && section === "simulate" ? [{ swatch: "bg-danger", label: "Hypothetical incident" }, { swatch: "bg-warning", label: "Assumed origin" }] : []),
  ];

  return (
    <div className="absolute inset-0">
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
        markers={overlay.markers}
        lines={overlay.lines}
        selectedHubId={selectedHubId}
        focus={state.focus}
        onSelectDevice={(device) => {
          setSelected(device);
          openDetail({ type: "vessel", device });
        }}
        onSelectHub={(hub) => openDetail({ type: "hub", fx: hub.fx, fy: hub.fy })}
        onPlace={overlay.onPlace}
      />
      <MapStatus label={loading ? loadingLabel : null} />
      {!dataset && !loading ? (
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
      {legend.length > 0 ? <MapLegend items={legend} /> : null}
    </div>
  );
}
