export type MapClickMode = "vessel" | "incident" | "coast_guard";

export type MapMarkerKind = "incident" | "coast_guard" | "medical" | "route" | "hypothetical";

export interface MapMarker {
  id: string;
  lon: number;
  lat: number;
  kind: MapMarkerKind;
  label: string;
}

export interface MapLine {
  id: string;
  coordinates: [number, number][];
  kind: "response" | "named" | "inferred";
  active?: boolean;
  /** 0–1 relative passage count. Width uses this. */
  weight?: number;
  /** Pixel offset so the two directions of a pair stay apart. */
  offset?: number;
  opacity?: number;
  /** Busiest connection is 0. Overview mode hides higher ranks until the map is closer. */
  rank?: number;
  /** 1 when unselected lines should fade with zoom. 0 when opacity is already final. */
  gated?: number;
}

export interface MapLocation {
  id: string;
  lon: number;
  lat: number;
  label: string;
  passages: number;
}

export interface MapLayerVisibility {
  hubs: boolean;
  vessels: boolean;
  trail: boolean;
  islands: boolean;
  connections: boolean;
  scenario: boolean;
}

export const DEFAULT_MAP_LAYERS: MapLayerVisibility = {
  hubs: true,
  vessels: true,
  trail: true,
  islands: true,
  connections: true,
  scenario: true,
};

export interface MapFocus {
  lon: number;
  lat: number;
  nonce: number;
  zoom?: number;
  bounds?: { west: number; south: number; east: number; north: number };
}

export interface MapOverlay {
  clickMode: MapClickMode;
  markers: MapMarker[];
  lines: MapLine[];
  locations?: MapLocation[];
  onPlace?: (lat: number, lon: number) => void;
  onSelectLocation?: (id: string) => void;
}

export const EMPTY_OVERLAY: MapOverlay = { clickMode: "vessel", markers: [], lines: [] };
