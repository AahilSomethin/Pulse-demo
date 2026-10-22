"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import {
  initialWorkspaceState,
  reduceWorkspace,
  type ClockZone,
  type DetailTarget,
  type ExploreTab,
  type NetworkFilters,
  type NetworkTab,
  type RouteDraft,
  type ScenarioDraft,
  type SidebarMode,
  type WorkspaceState,
} from "@/lib/workspace/state";
import type { MapLayerVisibility } from "@/types/map";

const STORAGE_KEY = "seapulse-workspace";

interface WorkspaceApi {
  state: WorkspaceState;
  setSidebar: (mode: SidebarMode) => void;
  openDetail: (detail: DetailTarget) => void;
  closeDetail: () => void;
  forgetDetail: () => void;
  reopenDetail: () => void;
  toggleLayer: (layer: keyof MapLayerVisibility) => void;
  setPresenting: (value: boolean) => void;
  setClock: (clock: ClockZone) => void;
  focusOn: (lon: number, lat: number, view?: { zoom?: number; bounds?: { west: number; south: number; east: number; north: number } }) => void;
  setPick: (pick: { lon: number; lat: number; label: string } | null) => void;
  setExploreTab: (tab: ExploreTab) => void;
  setNetworkTab: (tab: NetworkTab) => void;
  patchNetwork: (patch: Partial<NetworkFilters>) => void;
  patchScenario: (patch: Partial<ScenarioDraft>) => void;
  patchRoute: (patch: Partial<RouteDraft>) => void;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

function readPrefs(): { sidebar?: SidebarMode; layers?: Partial<MapLayerVisibility>; clock?: ClockZone } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sidebar?: SidebarMode; layers?: Partial<MapLayerVisibility>; clock?: ClockZone };
    const sidebar = parsed.sidebar === "expanded" || parsed.sidebar === "collapsed" || parsed.sidebar === "hidden" ? parsed.sidebar : undefined;
    const clock = parsed.clock === "utc" || parsed.clock === "mvt" ? parsed.clock : undefined;
    const layers = parsed.layers && typeof parsed.layers === "object" ? parsed.layers : undefined;
    return { sidebar, layers, clock };
  } catch {
    return null;
  }
}

const SERVER_STATE = initialWorkspaceState();
let snapshot = SERVER_STATE;
const listeners = new Set<() => void>();
let hydrated = false;
let clientReady = false;
let scheduled = false;

function ensureHydrated() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const prefs = readPrefs();
  if (prefs) snapshot = reduceWorkspace(snapshot, { type: "hydrate", ...prefs });
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (typeof window !== "undefined" && !clientReady && !scheduled) {
    scheduled = true;
    queueMicrotask(() => {
      clientReady = true;
      ensureHydrated();
      notify();
    });
  }
  return () => listeners.delete(listener);
}

function getSnapshot() {
  if (!clientReady) return SERVER_STATE;
  return snapshot;
}

function getServerSnapshot() {
  return SERVER_STATE;
}

function dispatchWorkspace(action: Parameters<typeof reduceWorkspace>[1]) {
  ensureHydrated();
  const next = reduceWorkspace(snapshot, action);
  if (next === snapshot) return;
  snapshot = next;
  if (action.type === "sidebar" || action.type === "toggle-layer" || action.type === "clock") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sidebar: snapshot.sidebar, layers: snapshot.layers, clock: snapshot.clock }));
  }
  notify();
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dispatch = useCallback((action: Parameters<typeof reduceWorkspace>[1]) => {
    dispatchWorkspace(action);
  }, []);

  const actions = useMemo(() => ({
    setSidebar: (mode: SidebarMode) => dispatch({ type: "sidebar", mode }),
    openDetail: (detail: DetailTarget) => {
      dispatch({ type: "open-detail", detail });
      if (window.matchMedia("(max-width: 1023px)").matches) dispatch({ type: "sidebar", mode: "collapsed" });
    },
    closeDetail: () => dispatch({ type: "close-detail" }),
    forgetDetail: () => dispatch({ type: "forget-detail" }),
    reopenDetail: () => dispatch({ type: "reopen-detail" }),
    toggleLayer: (layer: keyof MapLayerVisibility) => dispatch({ type: "toggle-layer", layer }),
    setPresenting: (value: boolean) => dispatch({ type: "present", value }),
    setClock: (clock: ClockZone) => dispatch({ type: "clock", clock }),
    focusOn: (lon: number, lat: number, view?: { zoom?: number; bounds?: { west: number; south: number; east: number; north: number } }) => dispatch({ type: "focus", lon, lat, zoom: view?.zoom, bounds: view?.bounds }),
    setPick: (pick: { lon: number; lat: number; label: string } | null) => dispatch({ type: "pick", pick }),
    setExploreTab: (tab: ExploreTab) => dispatch({ type: "explore-tab", tab }),
    setNetworkTab: (tab: NetworkTab) => dispatch({ type: "network-tab", tab }),
    patchNetwork: (patch: Partial<NetworkFilters>) => dispatch({ type: "network", patch }),
    patchScenario: (patch: Partial<ScenarioDraft>) => dispatch({ type: "scenario", patch }),
    patchRoute: (patch: Partial<RouteDraft>) => dispatch({ type: "route", patch }),
  }), [dispatch]);
  const api = useMemo<WorkspaceApi>(() => ({ state, ...actions }), [state, actions]);

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return value;
}
