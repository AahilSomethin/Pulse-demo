/**
 * MapLibre paint cannot read CSS variables. Hex values here match the roles in
 * globals.css. Basemap land and sea are retuned just far enough that islands
 * separate from the ocean; see VISUAL_AUDIT.md.
 */
export const MAP_COLORS = {
  dark: {
    sea: "#102D40",
    background: "#102D40",
    land: "#395C57",
    landLine: "#7F9AA6",
    hub: "#7EC8E3",
    hubLine: "#D7F3FA",
    hubHover: "#5EEAD4",
    vessel: "#8EBEFF",
    markerStroke: "#0B1C28",
    selected: "#2DD4BF",
    trail: "#7EC8E3",
    incident: "#F08A82",
    hypothetical: "#E0A44A",
    coastGuard: "#93C5FD",
    medical: "#34D399",
    route: "#3DCEC0",
    inferred: "#3DCEC0",
  },
  light: {
    sea: "#B9E1EF",
    background: "#B9E1EF",
    land: "#7A9A68",
    landLine: "#3E5C48",
    hub: "#087EA4",
    hubLine: "#0E4F6C",
    hubHover: "#0F766E",
    vessel: "#075CC4",
    markerStroke: "#FFFFFF",
    selected: "#0F766E",
    trail: "#087EA4",
    incident: "#C53636",
    hypothetical: "#9A6410",
    coastGuard: "#1D4ED8",
    medical: "#047857",
    route: "#00766C",
    inferred: "#00766C",
  },
} as const;

export type MapTheme = keyof typeof MAP_COLORS;

export const BASEMAP_STYLE = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;

/** Paint targets for the CARTO style. Zoom stops, filters, and widths stay in the source style. */
export const BASEMAP_PALETTE = {
  dark: {
    sea: "#102D40",
    land: "#395C57",
    vegetation: "#4E7568",
    urban: "#6A8494",
    urbanEdge: "#243844",
    road: "#D5DEE4",
    roadCase: "#8EA0AB",
    waterway: "#4E8CA3",
    coast: "#7F9AA6",
    label: "#E8F2F6",
    labelHalo: "#0C2433",
    waterLabel: "#D5E8F0",
    waterHalo: "#0C2433",
  },
  light: {
    sea: "#B9E1EF",
    land: "#7A9A68",
    vegetation: "#688B58",
    urban: "#E7E9DF",
    urbanEdge: "#D5D8CE",
    road: "#F7F8F4",
    roadCase: "#5C6B62",
    waterway: "#176B91",
    coast: "#5E7C8A",
    label: "#193348",
    labelHalo: "#F7FBFD",
    waterLabel: "#193348",
    waterHalo: "#E7F6FB",
  },
} as const;

export type BasemapPalette = (typeof BASEMAP_PALETTE)[MapTheme];
