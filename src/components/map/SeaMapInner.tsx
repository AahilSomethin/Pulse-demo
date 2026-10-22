"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { FeatureCollection, LineString, Point, Polygon } from "geojson";
import { setWorkerUrl, type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Layer, NavigationControl, Popup, ScaleControl, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";

import { MAP_CENTER } from "@/config/constants";
import { MAP_COLORS, type MapTheme } from "@/config/map-colors";
import { loadMaritimeStyle, type MaritimeStyle } from "@/lib/map/basemap";
import { trailIndexes } from "@/lib/vessels/frame";
import { hubFillOpacity, hubLineOpacity } from "@/lib/vessels/hub-style";
import type { MapClickMode, MapFocus, MapLayerVisibility, MapLine, MapLocation, MapMarker } from "@/types/map";
import type { ActivityFrame, Facility, LandPolygon, VesselDataset } from "@/types/maritime";

export type { MapClickMode, MapLine, MapMarker } from "@/types/map";

setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");

interface SeaMapProps {
  dataset: VesselDataset | null;
  polygons: LandPolygon[];
  facilities: Facility[];
  frame: ActivityFrame | null;
  selected: number;
  layers: MapLayerVisibility;
  cellDeg: number;
  theme: MapTheme;
  clickMode: MapClickMode;
  markers?: MapMarker[];
  lines?: MapLine[];
  locations?: MapLocation[];
  selectedHubId?: string | null;
  focus?: MapFocus | null;
  onSelectDevice?: (device: number) => void;
  onSelectHub?: (hub: { fx: number; fy: number }) => void;
  onSelectLocation?: (id: string) => void;
  onPlace?: (lat: number, lon: number) => void;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

interface SavedView {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

interface HubHover {
  id: string;
  devices: number;
  lon: number;
  lat: number;
}

function visibility(on: boolean): "visible" | "none" {
  return on ? "visible" : "none";
}

function liftPlaceLabels(map: MapLibreMap) {
  if (!map.getLayer("hub-line") || !map.getLayer("history-line")) return;
  const layers = map.getStyle()?.layers;
  if (!layers) return;
  const hubIndex = layers.findIndex((layer) => layer.id === "hub-line");
  const historyIndex = layers.findIndex((layer) => layer.id === "history-line");
  if (hubIndex < 0 || historyIndex < 0) return;
  const symbols = layers.filter((layer) => layer.type === "symbol");
  const placed = symbols.length > 0 && symbols.every((layer) => {
    const index = layers.findIndex((item) => item.id === layer.id);
    return index > hubIndex && index < historyIndex;
  });
  if (placed) return;
  for (const layer of symbols) {
    if (map.getLayer(layer.id)) map.moveLayer(layer.id, "history-line");
  }
}

function ensureConnectionArrow(map: MapLibreMap) {
  if (map.hasImage("connection-arrow")) return;
  const canvas = document.createElement("canvas");
  canvas.width = 20;
  canvas.height = 20;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, 20, 20);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(3, 4);
  context.lineTo(17, 10);
  context.lineTo(3, 16);
  context.closePath();
  context.fill();
  map.addImage("connection-arrow", context.getImageData(0, 0, 20, 20), { sdf: true });
}

function fallbackStyle(color: string) {
  return {
    version: 8 as const,
    sources: {},
    layers: [{ id: "background", type: "background" as const, paint: { "background-color": color } }],
  };
}

export default function SeaMapInner({
  dataset,
  polygons,
  facilities,
  frame,
  selected,
  layers,
  cellDeg,
  theme,
  clickMode,
  markers = [],
  lines = [],
  locations = [],
  selectedHubId = null,
  focus = null,
  onSelectDevice,
  onSelectHub,
  onSelectLocation,
  onPlace,
}: SeaMapProps) {
  const colors = MAP_COLORS[theme];
  const mapRef = useRef<MapRef>(null);
  const hoverRef = useRef<string | null>(null);
  const viewRef = useRef<SavedView | null>(null);
  const styleSeen = useRef<string | null>(null);
  const [hover, setHover] = useState<HubHover | null>(null);
  const [styles, setStyles] = useState<Partial<Record<MapTheme, MaritimeStyle>>>({});
  const [failedThemes, setFailedThemes] = useState<Partial<Record<MapTheme, boolean>>>({});
  const [ready, setReady] = useState(false);
  const styleReady = useRef(false);
  const styleFailed = Boolean(failedThemes[theme]);
  const maritimeStyle = styles[theme];
  const previousStyle = styles[theme === "dark" ? "light" : "dark"];
  const fallback = useMemo(() => fallbackStyle(colors.sea), [colors.sea]);
  const mapStyle = styleFailed ? fallback : maritimeStyle ?? previousStyle ?? fallback;
  const styleKey = styleFailed ? `failed:${theme}` : maritimeStyle ? theme : previousStyle ? `holding:${theme}` : `loading:${theme}`;
  const waitingForStyle = !styleFailed && !maritimeStyle && !previousStyle;

  const land = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: "FeatureCollection",
      features: polygons.map((polygon) => ({
        type: "Feature",
        properties: { name: polygon.name ?? "Unnamed polygon" },
        geometry: { type: "Polygon", coordinates: polygon.rings },
      })),
    }),
    [polygons],
  );

  const hubs = useMemo<FeatureCollection<Polygon>>(() => {
    if (!frame) return EMPTY as FeatureCollection<Polygon>;
    const maxDevices = frame.hubs.reduce((max, hub) => Math.max(max, hub.devices), 1);
    return {
      type: "FeatureCollection",
      features: frame.hubs.map((hub) => ({
        type: "Feature",
        id: `${hub.fx}:${hub.fy}`,
        properties: {
          devices: hub.devices,
          centerLon: hub.centerLon,
          centerLat: hub.centerLat,
          fx: hub.fx,
          fy: hub.fy,
          fillOpacity: hubFillOpacity(hub.devices, maxDevices),
          lineOpacity: hubLineOpacity(hub.devices, maxDevices, theme),
        },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [hub.fx * cellDeg, hub.fy * cellDeg],
            [(hub.fx + 1) * cellDeg, hub.fy * cellDeg],
            [(hub.fx + 1) * cellDeg, (hub.fy + 1) * cellDeg],
            [hub.fx * cellDeg, (hub.fy + 1) * cellDeg],
            [hub.fx * cellDeg, hub.fy * cellDeg],
          ]],
        },
      })),
    };
  }, [frame, cellDeg, theme]);

  const vessels = useMemo<FeatureCollection<Point>>(() => {
    if (!dataset || !frame) return EMPTY as FeatureCollection<Point>;
    return {
      type: "FeatureCollection",
      features: frame.positions.map((position) => ({
        type: "Feature",
        properties: {
          device: position.device,
          selected: position.device === selected ? 1 : 0,
          label: dataset.names[position.device] ?? "",
        },
        geometry: { type: "Point", coordinates: [dataset.lon[position.index], dataset.lat[position.index]] },
      })),
    };
  }, [dataset, frame, selected]);

  const history = useMemo<FeatureCollection<LineString>>(() => {
    if (!dataset || selected < 0) return EMPTY as FeatureCollection<LineString>;
    const indexes = dataset.tracks[selected] ?? [];
    if (indexes.length < 2) return EMPTY as FeatureCollection<LineString>;
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: indexes.map((index) => [dataset.lon[index], dataset.lat[index]]) },
      }],
    };
  }, [dataset, selected]);

  const windowTrail = useMemo<FeatureCollection<LineString>>(() => {
    if (!dataset || !frame || selected < 0) return EMPTY as FeatureCollection<LineString>;
    const indexes = trailIndexes(dataset, selected, frame.cursorMs, frame.windowMs);
    if (indexes.length < 2) return EMPTY as FeatureCollection<LineString>;
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: indexes.map((index) => [dataset.lon[index], dataset.lat[index]]) },
      }],
    };
  }, [dataset, frame, selected]);

  const markerData = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: [
        ...facilities.map((facility) => ({
          type: "Feature" as const,
          properties: { kind: facility.kind, label: facility.verified ? facility.name : `${facility.name} (unverified)` },
          geometry: { type: "Point" as const, coordinates: [facility.lon, facility.lat] as [number, number] },
        })),
        ...markers.map((marker) => ({
          type: "Feature" as const,
          properties: { kind: marker.kind, label: marker.label },
          geometry: { type: "Point" as const, coordinates: [marker.lon, marker.lat] as [number, number] },
        })),
      ],
    }),
    [facilities, markers],
  );

  const lineData = useMemo<FeatureCollection<LineString>>(
    () => ({
      type: "FeatureCollection",
      features: lines.filter((line) => line.coordinates.length > 1).map((line) => ({
        type: "Feature" as const,
        properties: {
          kind: line.kind,
          active: line.active ? 1 : 0,
          weight: line.weight ?? 0.45,
          offset: line.offset ?? 0,
          opacity: line.opacity ?? 0.9,
        },
        geometry: { type: "LineString" as const, coordinates: line.coordinates },
      })),
    }),
    [lines],
  );

  const locationData = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: locations.map((location) => ({
        type: "Feature" as const,
        properties: { id: location.id, label: location.label, passages: location.passages },
        geometry: { type: "Point" as const, coordinates: [location.lon, location.lat] as [number, number] },
      })),
    }),
    [locations],
  );

  useEffect(() => {
    if (styles[theme] || failedThemes[theme]) return;
    let cancelled = false;
    loadMaritimeStyle(theme).then(
      (style) => {
        if (!cancelled) setStyles((current) => ({ ...current, [theme]: style }));
      },
      () => {
        if (!cancelled) setFailedThemes((current) => ({ ...current, [theme]: true }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [theme, styles, failedThemes]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready) return;
    const save = () => {
      const center = map.getCenter();
      viewRef.current = { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    };
    save();
    map.on("moveend", save);
    return () => {
      map.off("moveend", save);
    };
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready) return;
    if (styleSeen.current === null) {
      styleSeen.current = styleKey;
      return;
    }
    if (styleSeen.current === styleKey) return;
    styleSeen.current = styleKey;
    const view = viewRef.current;
    if (!view) return;
    const restore = () => {
      if (!map.isStyleLoaded()) return;
      map.off("styledata", restore);
      map.jumpTo({ center: view.center, zoom: view.zoom, bearing: view.bearing, pitch: view.pitch });
    };
    restore();
    map.on("styledata", restore);
    return () => {
      map.off("styledata", restore);
    };
  }, [styleKey, ready]);

  useEffect(() => {
    if (!dataset) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const map = mapRef.current?.getMap();
      if (!map || map.getContainer().clientWidth === 0 || !map.isStyleLoaded()) {
        if (attempts > 40) window.clearInterval(timer);
        return;
      }
      map.fitBounds(
        [
          [dataset.bounds.minLon, dataset.bounds.minLat],
          [dataset.bounds.maxLon, dataset.bounds.maxLat],
        ],
        { padding: 48, maxZoom: 12, duration: 0 },
      );
      window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [dataset]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready) return;
    const onIdle = () => liftPlaceLabels(map);
    map.on("idle", onIdle);
    return () => {
      map.off("idle", onIdle);
    };
  }, [theme, styleFailed, ready]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    const container = map?.getContainer();
    if (!map || !container || !ready) return;
    let width = container.clientWidth;
    let height = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextWidth = container.clientWidth;
      const nextHeight = container.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      map.resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    if (!focus || !ready) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.easeTo({
      center: [focus.lon, focus.lat],
      zoom: Math.max(map.getZoom(), 8),
      duration: reduced ? 0 : 450,
      essential: true,
    });
  }, [focus, ready]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    const currentId = hoverRef.current;
    if (!map || currentId == null || !ready) return;
    const feature = hubs.features.find((item) => item.id === currentId);
    if (!feature) {
      if (map.getSource("hubs")) map.setFeatureState({ source: "hubs", id: currentId }, { hover: false });
      hoverRef.current = null;
      setHover(null);
      return;
    }
    const devices = Number(feature.properties?.devices ?? 0);
    setHover((current) => (current && current.id === currentId && current.devices !== devices ? { ...current, devices } : current));
    const apply = () => {
      if (hoverRef.current === currentId && map.getSource("hubs")) {
        map.setFeatureState({ source: "hubs", id: currentId }, { hover: true });
      }
    };
    map.once("idle", apply);
    return () => {
      map.off("idle", apply);
    };
  }, [hubs, ready]);

  const selectedHubRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map?.getSource("hubs") || !ready) return;
    const previous = selectedHubRef.current;
    if (previous && previous !== selectedHubId) {
      map.setFeatureState({ source: "hubs", id: previous }, { selected: false });
    }
    if (selectedHubId) map.setFeatureState({ source: "hubs", id: selectedHubId }, { selected: true });
    selectedHubRef.current = selectedHubId;
  }, [hubs, selectedHubId, ready]);

  function clearHover(map = mapRef.current?.getMap()) {
    const currentId = hoverRef.current;
    if (currentId != null && map?.getSource("hubs")) {
      map.setFeatureState({ source: "hubs", id: currentId }, { hover: false });
    }
    hoverRef.current = null;
    setHover(null);
  }

  function onMouseMove(event: MapLayerMouseEvent) {
    if (!layers.hubs) {
      clearHover();
      return;
    }
    const map = mapRef.current?.getMap();
    const hub = event.features?.find((feature) => feature.layer?.id === "hub-fill");
    const nextId = hub?.id == null ? null : String(hub.id);
    if (!map || nextId === hoverRef.current) return;
    if (hoverRef.current != null && map.getSource("hubs")) {
      map.setFeatureState({ source: "hubs", id: hoverRef.current }, { hover: false });
    }
    hoverRef.current = nextId;
    if (nextId == null || !hub) {
      setHover(null);
      return;
    }
    map.setFeatureState({ source: "hubs", id: nextId }, { hover: true });
    const devices = Number(hub.properties?.devices ?? 0);
    const lon = Number(hub.properties?.centerLon);
    const lat = Number(hub.properties?.centerLat);
    setHover({
      id: nextId,
      devices,
      lon: Number.isFinite(lon) ? lon : event.lngLat.lng,
      lat: Number.isFinite(lat) ? lat : event.lngLat.lat,
    });
  }

  function onClick(event: MapLayerMouseEvent) {
    if (clickMode !== "vessel") {
      onPlace?.(event.lngLat.lat, event.lngLat.lng);
      return;
    }
    const deviceFeature = event.features?.find((feature) => feature.layer?.id === "vessel-hit");
    const device = Number(deviceFeature?.properties?.device);
    if (Number.isInteger(device)) {
      onSelectDevice?.(device);
      return;
    }
    const location = event.features?.find((feature) => feature.layer?.id === "location-hit");
    const locationId = location?.properties?.id;
    if (typeof locationId === "string" && locationId) {
      onSelectLocation?.(locationId);
      return;
    }
    const hub = event.features?.find((feature) => feature.layer?.id === "hub-fill");
    const fx = Number(hub?.properties?.fx);
    const fy = Number(hub?.properties?.fy);
    if (hub && Number.isInteger(fx) && Number.isInteger(fy)) onSelectHub?.({ fx, fy });
  }

  const interactiveLayerIds = [
    ...(clickMode === "vessel" && (layers.vessels || selected >= 0) ? ["vessel-hit"] : []),
    ...(locations.length > 0 && layers.connections ? ["location-hit"] : []),
    ...(layers.hubs ? ["hub-fill"] : []),
  ];

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const addArrow = () => ensureConnectionArrow(map);
    if (map.isStyleLoaded()) addArrow();
    const onMissing = (event: { id: string }) => {
      if (event.id === "connection-arrow") ensureConnectionArrow(map);
    };
    map.on("style.load", addArrow);
    map.on("styleimagemissing", onMissing);
    return () => {
      map.off("style.load", addArrow);
      map.off("styleimagemissing", onMissing);
    };
  }, [mapStyle]);

  if (waitingForStyle) {
    return <div className="h-full w-full bg-background" />;
  }

  return (
    <MapGL
      ref={mapRef}
      initialViewState={MAP_CENTER}
      mapStyle={mapStyle as StyleSpecification}
      minZoom={4}
      maxZoom={16}
      attributionControl={{ compact: true }}
      cursor={clickMode === "vessel" ? "pointer" : "crosshair"}
      interactiveLayerIds={interactiveLayerIds}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={() => clearHover()}
      onLoad={() => {
        styleReady.current = true;
        setReady(true);
        const map = mapRef.current?.getMap();
        if (map) {
          ensureConnectionArrow(map);
          map.on("styleimagemissing", (event) => {
            if (event.id === "connection-arrow") ensureConnectionArrow(map);
          });
          liftPlaceLabels(map);
          map.resize();
        }
      }}
      onError={(event) => {
        const message = event.error?.message ?? "";
        if (maritimeStyle || styleReady.current || !/style|sprite|glyph/i.test(message)) return;
        queueMicrotask(() => {
          if (!styleReady.current) setFailedThemes((current) => ({ ...current, [theme]: true }));
        });
      }}
    >
      <NavigationControl position="top-left" showCompass={false} />
      <ScaleControl position="bottom-left" />
      <Source id="land" type="geojson" data={land}>
        <Layer id="land-fill" type="fill" layout={{ visibility: visibility(layers.islands) }} paint={{ "fill-color": colors.land, "fill-opacity": 0.35 }} />
        <Layer id="land-line" type="line" layout={{ visibility: visibility(layers.islands) }} paint={{ "line-color": colors.landLine, "line-width": 1 }} />
      </Source>
      <Source id="hubs" type="geojson" data={hubs}>
        <Layer
          id="hub-fill"
          type="fill"
          layout={{ visibility: visibility(layers.hubs) }}
          paint={{
            "fill-color": colors.hub,
            "fill-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              ["min", 0.25, ["*", 0.55, ["get", "fillOpacity"]]],
              7.5,
              ["min", 0.25, ["get", "fillOpacity"]],
            ],
          }}
        />
        <Layer
          id="hub-line"
          type="line"
          layout={{ visibility: visibility(layers.hubs) }}
          paint={{
            "line-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              colors.selected,
              ["boolean", ["feature-state", "hover"], false],
              colors.hubHover,
              colors.hubLine,
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              2.5,
              ["boolean", ["feature-state", "hover"], false],
              2,
              1,
            ],
            "line-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              ["case", ["boolean", ["feature-state", "hover"], false], 0.9, ["boolean", ["feature-state", "selected"], false], 0.9, 0],
              8.5,
              ["case", ["boolean", ["feature-state", "hover"], false], 0.9, ["boolean", ["feature-state", "selected"], false], 0.95, ["get", "lineOpacity"]],
            ],
          }}
        />
      </Source>
      {hover && layers.hubs ? (
        <Popup
          longitude={hover.lon}
          latitude={hover.lat}
          anchor="bottom"
          offset={10}
          closeButton={false}
          closeOnClick={false}
          className="hub-tip"
          maxWidth="16rem"
        >
          <span className="tabular-nums">{hover.devices} unique {hover.devices === 1 ? "vessel" : "vessels"}</span>
        </Popup>
      ) : null}
      <Source id="history" type="geojson" data={history}>
        <Layer id="history-line" type="line" layout={{ visibility: visibility(layers.trail) }} paint={{ "line-color": colors.trail, "line-width": 1.5, "line-opacity": 0.35 }} />
      </Source>
      <Source id="window-trail" type="geojson" data={windowTrail}>
        <Layer id="window-line" type="line" layout={{ visibility: visibility(layers.trail) }} paint={{ "line-color": colors.trail, "line-width": 3 }} />
      </Source>
      <Source id="links" type="geojson" data={lineData}>
        <Layer
          id="link-inferred"
          type="line"
          filter={["==", ["get", "kind"], "inferred"]}
          layout={{ visibility: visibility(layers.connections) }}
          paint={{
            "line-color": colors.inferred,
            "line-width": ["+", ["case", ["==", ["get", "active"], 1], 1.5, 0], ["interpolate", ["linear"], ["get", "weight"], 0, 1.25, 1, 5]],
            "line-offset": ["get", "offset"],
            "line-opacity": ["get", "opacity"],
            "line-dasharray": [2, 2],
          }}
        />
        <Layer
          id="link-named"
          type="line"
          filter={["==", ["get", "kind"], "named"]}
          layout={{ visibility: visibility(layers.connections) }}
          paint={{
            "line-color": colors.route,
            "line-width": ["+", ["case", ["==", ["get", "active"], 1], 1.5, 0], ["interpolate", ["linear"], ["get", "weight"], 0, 1.5, 1, 5.5]],
            "line-offset": ["get", "offset"],
            "line-opacity": ["get", "opacity"],
          }}
        />
        <Layer
          id="link-response"
          type="line"
          filter={["==", ["get", "kind"], "response"]}
          layout={{ visibility: visibility(layers.scenario) }}
          paint={{
            "line-color": colors.incident,
            "line-width": ["case", ["==", ["get", "active"], 1], 4, 2],
            "line-dasharray": [5, 3],
          }}
        />
        <Layer
          id="link-arrows"
          type="symbol"
          filter={["!=", ["get", "kind"], "response"]}
          layout={{
            visibility: visibility(layers.connections),
            "symbol-placement": "line",
            "symbol-spacing": 90,
            "icon-image": "connection-arrow",
            "icon-size": 0.55,
            "icon-allow-overlap": true,
            "icon-rotation-alignment": "map",
          }}
          paint={{ "icon-color": colors.route, "icon-opacity": ["get", "opacity"] }}
        />
      </Source>
      <Source id="locations" type="geojson" data={locationData}>
        <Layer id="location-hit" type="circle" paint={{ "circle-radius": 14, "circle-opacity": 0 }} />
        <Layer
          id="location-dots"
          type="circle"
          layout={{ visibility: visibility(layers.connections) }}
          paint={{
            "circle-radius": ["interpolate", ["linear"], ["get", "passages"], 1, 4, 40, 9],
            "circle-color": colors.selected,
            "circle-opacity": 0.85,
            "circle-stroke-color": colors.markerStroke,
            "circle-stroke-width": 1,
          }}
        />
      </Source>
      <Source id="vessels" type="geojson" data={vessels}>
        <Layer id="vessel-hit" type="circle" paint={{ "circle-radius": 12, "circle-opacity": 0, "circle-stroke-width": 0 }} />
        <Layer
          id="vessel-dots"
          type="circle"
          filter={["!=", ["get", "selected"], 1]}
          layout={{ visibility: visibility(layers.vessels) }}
          paint={{
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.5, 8, 3.5, 12, 4.5],
            "circle-color": colors.vessel,
            "circle-stroke-color": colors.markerStroke,
            "circle-stroke-width": 1,
          }}
        />
        <Layer
          id="vessel-selected"
          type="circle"
          filter={["==", ["get", "selected"], 1]}
          paint={{
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 5, 8, 6.5, 12, 8],
            "circle-color": colors.selected,
            "circle-stroke-color": colors.markerStroke,
            "circle-stroke-width": 2,
          }}
        />
      </Source>
      <Source id="markers" type="geojson" data={markerData}>
        <Layer
          id="marker-dots"
          type="circle"
          layout={{ visibility: visibility(layers.scenario) }}
          paint={{
            "circle-radius": 6,
            "circle-stroke-width": 2,
            "circle-stroke-color": colors.markerStroke,
            "circle-color": [
              "match",
              ["get", "kind"],
              "incident",
              colors.incident,
              "hypothetical",
              colors.hypothetical,
              "medical",
              colors.medical,
              "coast_guard",
              colors.coastGuard,
              colors.route,
            ],
          }}
        />
      </Source>
    </MapGL>
  );
}
