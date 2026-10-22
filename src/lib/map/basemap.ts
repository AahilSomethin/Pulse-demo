import { BASEMAP_PALETTE, BASEMAP_STYLE, type BasemapPalette, type MapTheme } from "@/config/map-colors";

export interface MaritimeStyle {
  version: 8;
  name?: string;
  metadata?: unknown;
  sources: Record<string, { attribution?: string } & Record<string, unknown>>;
  sprite?: string;
  glyphs?: string;
  layers: CartoLayer[];
  [key: string]: unknown;
}

interface CartoLayer {
  id: string;
  type?: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  filter?: unknown;
  minzoom?: number;
  maxzoom?: number;
  [key: string]: unknown;
}

const VEGETATION = new Set(["landcover", "park_national_park", "park_nature_reserve", "landuse"]);
const COLOR_KEY = new Set([
  "background-color",
  "fill-color",
  "fill-outline-color",
  "line-color",
  "text-color",
  "text-halo-color",
  "icon-color",
]);

const cache = new Map<MapTheme, Promise<MaritimeStyle>>();

export function loadMaritimeStyle(theme: MapTheme): Promise<MaritimeStyle> {
  const hit = cache.get(theme);
  if (hit) return hit;
  const pending = fetch(BASEMAP_STYLE[theme])
    .then((response) => {
      if (!response.ok) throw new Error(`Basemap style ${response.status}`);
      return response.json() as Promise<MaritimeStyle>;
    })
    .then((style) => recolorCartoStyle(style, theme));
  cache.set(theme, pending);
  pending.catch(() => {
    if (cache.get(theme) === pending) cache.delete(theme);
  });
  return pending;
}

/**
 * Recolors a CARTO Positron or Dark Matter style. Filters, zoom limits, line
 * widths, opacities, and dash arrays are copied through. Only color paint is
 * replaced, and transparent values stay transparent.
 */
export function recolorCartoStyle(style: MaritimeStyle, theme: MapTheme): MaritimeStyle {
  const palette = BASEMAP_PALETTE[theme];
  const next = structuredClone(style);
  next.layers = next.layers.map((layer) => recolorLayer(layer, palette));
  return next;
}

function recolorLayer(layer: CartoLayer, palette: BasemapPalette): CartoLayer {
  if (!layer.paint) return layer;
  const paint = { ...layer.paint };
  let changed = false;
  for (const key of Object.keys(paint)) {
    if (!COLOR_KEY.has(key)) continue;
    const target = colorFor(layer.id, key, palette);
    if (!target) continue;
    paint[key] = repaint(paint[key], target);
    changed = true;
  }
  if (!changed) return layer;
  return { ...layer, paint };
}

function colorFor(id: string, key: string, palette: BasemapPalette): string | null {
  if (id === "water_shadow" || id === "housenumber") return null;
  if (id === "background") return key === "background-color" ? palette.land : null;
  if (id === "water") return key === "fill-color" ? palette.sea : null;
  if (id === "waterway") return key === "line-color" ? palette.waterway : null;
  if (id.startsWith("watername") || id === "waterway_label") {
    if (key === "text-color") return palette.waterLabel;
    if (key === "text-halo-color") return palette.waterHalo;
    return null;
  }
  if (VEGETATION.has(id)) return key === "fill-color" ? palette.vegetation : null;
  if (id === "landuse_residential") return key === "fill-color" ? palette.urban : null;
  if (id === "building" || id === "building-top") {
    if (key === "fill-color") return palette.urban;
    if (key === "fill-outline-color") return palette.urbanEdge;
    return null;
  }
  if (id.startsWith("boundary_")) return key === "line-color" ? palette.coast : null;
  if (id.startsWith("roadname_") || id.startsWith("place_") || id.startsWith("poi_")) {
    if (key === "text-color" || key === "icon-color") return palette.label;
    if (key === "text-halo-color") return palette.labelHalo;
    return null;
  }
  if (isRoad(id)) {
    if (key !== "line-color") return null;
    if (id.includes("dash")) return palette.road;
    if (id.includes("case") || id.includes("path") || id === "rail" || id.includes("rail")) return palette.roadCase;
    return palette.road;
  }
  return null;
}

function isRoad(id: string): boolean {
  return id.startsWith("road_") || id.startsWith("tunnel_") || id.startsWith("bridge_") || id.startsWith("aeroway") || id === "rail" || id.startsWith("rail_");
}

function repaint(value: unknown, next: string): unknown {
  if (typeof value === "string") {
    if (!isColor(value) || value === "transparent") return value;
    return withAlpha(value, next);
  }
  if (Array.isArray(value)) return value.map((item) => repaint(item, next));
  if (value && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = repaint(item, next);
    return copy;
  }
  return value;
}

function isColor(value: string): boolean {
  return value === "transparent" || /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) || /^(?:rgb|hsl)a?\(/i.test(value);
}

function withAlpha(original: string, hex: string): string {
  const alpha = readAlpha(original);
  if (alpha == null || alpha >= 1) return hex;
  const { r, g, b } = hexToRgb(hex);
  const compact = Math.round(alpha * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${compact})`;
}

function readAlpha(color: string): number | null {
  const rgba = color.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i);
  if (rgba) return Number(rgba[1]);
  if (/^#[0-9a-f]{8}$/i.test(color)) return Number.parseInt(color.slice(7, 9), 16) / 255;
  if (/^#[0-9a-f]{4}$/i.test(color)) return Number.parseInt(color[4] + color[4], 16) / 255;
  return null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.slice(1);
  const expanded = value.length === 3 ? value.split("").map((channel) => channel + channel).join("") : value.slice(0, 6);
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}
