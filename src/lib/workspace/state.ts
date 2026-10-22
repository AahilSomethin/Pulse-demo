import { DEFAULT_COAST_GUARD_KN, DEFAULT_RESPONSE_RADIUS_M, DEFAULT_VESSEL_RESPONSE_KN } from "@/config/constants";
import { DEFAULT_MAP_LAYERS, type MapFocus, type MapLayerVisibility } from "@/types/map";

export type SidebarMode = "expanded" | "collapsed" | "hidden";
export type ClockZone = "utc" | "mvt";
export type ExploreTab = "data" | "vessels" | "hubs";
export type NetworkTab = "observed" | "routes";
export type PlaceKind = "inferred_activity" | "named_island";

export type DetailTarget =
  | { type: "vessel"; device: number }
  | { type: "hub"; fx: number; fy: number }
  | { type: "connection"; id: string }
  | { type: "scenario"; id: string };

export interface ScenarioDraft {
  incident: { lat: number; lon: number } | null;
  coastGuard: { lat: number; lon: number } | null;
  radiusKm: number;
  vesselKn: number;
  coastGuardKn: number;
  placing: "incident" | "coast_guard";
}

export interface RouteDraft {
  placeKind: PlaceKind;
  pair: string;
  proposedMin: number;
}

export interface WorkspaceState {
  sidebar: SidebarMode;
  detailsOpen: boolean;
  detail: DetailTarget | null;
  layers: MapLayerVisibility;
  presenting: boolean;
  clock: ClockZone;
  focus: MapFocus | null;
  exploreTab: ExploreTab;
  networkTab: NetworkTab;
  scenario: ScenarioDraft;
  route: RouteDraft;
}

export type WorkspaceAction =
  | { type: "hydrate"; sidebar?: SidebarMode; layers?: Partial<MapLayerVisibility>; clock?: ClockZone }
  | { type: "sidebar"; mode: SidebarMode }
  | { type: "open-detail"; detail: DetailTarget }
  | { type: "close-detail" }
  | { type: "reopen-detail" }
  | { type: "forget-detail" }
  | { type: "toggle-layer"; layer: keyof MapLayerVisibility }
  | { type: "present"; value: boolean }
  | { type: "clock"; clock: ClockZone }
  | { type: "focus"; lon: number; lat: number }
  | { type: "explore-tab"; tab: ExploreTab }
  | { type: "network-tab"; tab: NetworkTab }
  | { type: "scenario"; patch: Partial<ScenarioDraft> }
  | { type: "route"; patch: Partial<RouteDraft> };

export function initialWorkspaceState(): WorkspaceState {
  return {
    sidebar: "expanded",
    detailsOpen: false,
    detail: null,
    layers: { ...DEFAULT_MAP_LAYERS },
    presenting: false,
    clock: "utc",
    focus: null,
    exploreTab: "data",
    networkTab: "observed",
    scenario: {
      incident: null,
      coastGuard: null,
      radiusKm: DEFAULT_RESPONSE_RADIUS_M / 1000,
      vesselKn: DEFAULT_VESSEL_RESPONSE_KN,
      coastGuardKn: DEFAULT_COAST_GUARD_KN,
      placing: "incident",
    },
    route: {
      placeKind: "inferred_activity",
      pair: "",
      proposedMin: 30,
    },
  };
}

export function connectionId(placeKind: PlaceKind, origin: string, destination: string): string {
  return `${placeKind}:${origin}\u0000${destination}`;
}

export function reduceWorkspace(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "hydrate":
      return {
        ...state,
        sidebar: action.sidebar ?? state.sidebar,
        clock: action.clock ?? state.clock,
        layers: { ...state.layers, ...action.layers },
      };
    case "sidebar":
      return state.sidebar === action.mode ? state : { ...state, sidebar: action.mode };
    case "open-detail":
      return { ...state, detail: action.detail, detailsOpen: true };
    case "close-detail":
      return { ...state, detailsOpen: false };
    case "forget-detail":
      return { ...state, detail: null, detailsOpen: false };
    case "reopen-detail":
      return state.detail ? { ...state, detailsOpen: true } : state;
    case "toggle-layer":
      return { ...state, layers: { ...state.layers, [action.layer]: !state.layers[action.layer] } };
    case "present":
      return state.presenting === action.value ? state : { ...state, presenting: action.value };
    case "clock":
      return state.clock === action.clock ? state : { ...state, clock: action.clock };
    case "focus":
      return { ...state, focus: { lon: action.lon, lat: action.lat, nonce: (state.focus?.nonce ?? 0) + 1 } };
    case "explore-tab":
      return state.exploreTab === action.tab ? state : { ...state, exploreTab: action.tab };
    case "network-tab":
      return state.networkTab === action.tab ? state : { ...state, networkTab: action.tab };
    case "scenario":
      return { ...state, scenario: { ...state.scenario, ...action.patch } };
    case "route":
      return { ...state, route: { ...state.route, ...action.patch } };
    default:
      return state;
  }
}
