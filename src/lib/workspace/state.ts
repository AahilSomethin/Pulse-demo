import { DEFAULT_COAST_GUARD_KN, DEFAULT_RESPONSE_RADIUS_M, DEFAULT_VESSEL_RESPONSE_KN } from "@/config/constants";
import { DEFAULT_MAP_LAYERS, type MapFocus, type MapLayerVisibility } from "@/types/map";

export type SidebarMode = "expanded" | "collapsed" | "hidden";
export type ClockZone = "utc" | "mvt";
export type ExploreTab = "data" | "vessels" | "hubs";
export type NetworkTab = "observed" | "opportunities" | "routes" | "frequency";
export type PlaceKind = "inferred_activity" | "named_island";
export type GeoClassFilter = "all" | "inferred" | "named" | "harbour";
export type EvidenceFilter = "all" | "limited" | "adequate";

export interface NetworkFilters {
  scope: "day" | "month";
  minPassages: number;
  minDurationMin: number;
  maxDurationMin: number;
  geoClass: GeoClassFilter;
  evidence: EvidenceFilter;
  minVariability: number;
  atoll: string;
}

export type DetailTarget =
  | { type: "vessel"; device: number }
  | { type: "hub"; fx: number; fy: number }
  | { type: "connection"; id: string }
  | { type: "location"; id: string }
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

/** A demo answer from one boat operator for one recorded passage and one pin. */
export interface RescueConsent {
  device: number;
  routeKey: string;
  incidentKey: string;
  routeLabel: string;
  choice: "offer" | "decline";
}

export interface WorkspaceState {
  sidebar: SidebarMode;
  detailsOpen: boolean;
  detail: DetailTarget | null;
  layers: MapLayerVisibility;
  presenting: boolean;
  clock: ClockZone;
  focus: MapFocus | null;
  /** One reference point chosen from search. It is not a connection. */
  pick: { lon: number; lat: number; label: string } | null;
  exploreTab: ExploreTab;
  networkTab: NetworkTab;
  network: NetworkFilters;
  scenario: ScenarioDraft;
  route: RouteDraft;
  /** Demo operator. A device index, not an account. */
  boatDevice: number | null;
  /** Tracker file the chosen boat belongs to. A new file clears the demo. */
  boatSource: string | null;
  consents: RescueConsent[];
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
  | { type: "focus"; lon: number; lat: number; zoom?: number; bounds?: MapFocus["bounds"] }
  | { type: "pick"; pick: { lon: number; lat: number; label: string } | null }
  | { type: "explore-tab"; tab: ExploreTab }
  | { type: "network-tab"; tab: NetworkTab }
  | { type: "network"; patch: Partial<NetworkFilters> }
  | { type: "scenario"; patch: Partial<ScenarioDraft> }
  | { type: "route"; patch: Partial<RouteDraft> }
  | { type: "boat-device"; device: number | null; source: string }
  | { type: "rescue-consent"; consent: RescueConsent }
  | { type: "reset-boat" };

export function initialWorkspaceState(): WorkspaceState {
  return {
    sidebar: "expanded",
    detailsOpen: false,
    detail: null,
    layers: { ...DEFAULT_MAP_LAYERS },
    presenting: false,
    clock: "utc",
    focus: null,
    pick: null,
    exploreTab: "data",
    networkTab: "observed",
    network: {
      scope: "day",
      minPassages: 1,
      minDurationMin: 0,
      maxDurationMin: 0,
      geoClass: "all",
      evidence: "all",
      minVariability: 0,
      atoll: "",
    },
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
    boatDevice: null,
    boatSource: null,
    consents: [],
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
      return {
        ...state,
        focus: {
          lon: action.lon,
          lat: action.lat,
          zoom: action.zoom,
          bounds: action.bounds,
          nonce: (state.focus?.nonce ?? 0) + 1,
        },
      };
    case "pick":
      return { ...state, pick: action.pick };
    case "explore-tab":
      return state.exploreTab === action.tab ? state : { ...state, exploreTab: action.tab };
    case "network-tab":
      return state.networkTab === action.tab ? state : { ...state, networkTab: action.tab };
    case "network":
      return { ...state, network: { ...state.network, ...action.patch } };
    case "scenario":
      return { ...state, scenario: { ...state.scenario, ...action.patch } };
    case "route":
      return { ...state, route: { ...state.route, ...action.patch } };
    case "boat-device": {
      const source = action.device == null ? null : action.source;
      if (state.boatDevice === action.device && state.boatSource === source) return state;
      return { ...state, boatDevice: action.device, boatSource: source };
    }
    case "rescue-consent": {
      const index = state.consents.findIndex((item) => (
        item.device === action.consent.device
        && item.routeKey === action.consent.routeKey
        && item.incidentKey === action.consent.incidentKey
      ));
      if (index >= 0 && state.consents[index].choice === action.consent.choice && state.consents[index].routeLabel === action.consent.routeLabel) {
        return state;
      }
      const consents = state.consents.filter((_, itemIndex) => itemIndex !== index);
      return { ...state, consents: [...consents, action.consent] };
    }
    case "reset-boat":
      return state.boatDevice === null && state.boatSource === null && state.consents.length === 0
        ? state
        : { ...state, boatDevice: null, boatSource: null, consents: [] };
    default:
      return state;
  }
}
