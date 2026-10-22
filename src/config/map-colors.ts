/**
 * MapLibre paint cannot read CSS variables. Keep these aligned with globals.css.
 */
export const MAP_COLORS = {
  dark: {
    background: "#071422",
    land: "#1c3d36",
    landLine: "#3d6b62",
    hub: "#38bdf8",
    hubLine: "#22d3ee",
    hubHover: "#5eead4",
    vessel: "#7cc4ff",
    selected: "#2dd4bf",
    trail: "#2dd4bf",
    incident: "#f07167",
    hypothetical: "#fbbf24",
    coastGuard: "#93c5fd",
    medical: "#34d399",
    route: "#2dd4bf",
    inferred: "#22d3ee",
  },
  light: {
    background: "#e6f0f8",
    land: "#b9c9b0",
    landLine: "#6d8064",
    hub: "#0369a1",
    hubLine: "#0e7490",
    hubHover: "#0f766e",
    vessel: "#0b5cad",
    selected: "#0f766e",
    trail: "#0f766e",
    incident: "#b42318",
    hypothetical: "#a16207",
    coastGuard: "#1d4ed8",
    medical: "#15803d",
    route: "#0f766e",
    inferred: "#0e7490",
  },
} as const;

export type MapTheme = keyof typeof MAP_COLORS;

export const BASEMAP_STYLE = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;
