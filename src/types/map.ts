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
}

export interface MapOverlay {
  clickMode: MapClickMode;
  markers: MapMarker[];
  lines: MapLine[];
  onPlace?: (lat: number, lon: number) => void;
}

export const EMPTY_OVERLAY: MapOverlay = { clickMode: "vessel", markers: [], lines: [] };
