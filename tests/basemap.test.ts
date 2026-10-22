import { describe, expect, it } from "vitest";

import { BASEMAP_PALETTE } from "@/config/map-colors";
import { recolorCartoStyle, type MaritimeStyle } from "@/lib/map/basemap";

const fixture: MaritimeStyle = {
  version: 8,
  sources: {
    protomaps: { type: "vector", attribution: "© OpenStreetMap contributors © CARTO" },
  },
  sprite: "https://example.test/sprite",
  glyphs: "https://example.test/fonts/{fontstack}/{range}.pbf",
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#fafaf8", "background-opacity": 1 } },
    {
      id: "landcover",
      type: "fill",
      minzoom: 7,
      filter: ["in", ["get", "kind"], ["literal", ["wood", "grass"]]],
      paint: { "fill-color": { stops: [[8, "rgba(234, 241, 233, 0.5)"], [15, "rgba(234, 241, 233, 0.5)"]] }, "fill-opacity": 1 },
    },
    {
      id: "landuse_residential",
      type: "fill",
      minzoom: 6,
      filter: ["==", ["get", "kind"], "residential"],
      paint: { "fill-color": { stops: [[5, "rgba(237, 237, 237, 0.5)"], [16, "rgba(237, 237, 237, 0.25)"]] }, "fill-opacity": { stops: [[6, 0.6], [9, 1]] } },
    },
    { id: "water", type: "fill", paint: { "fill-color": "#d4dadc", "fill-opacity": 1 } },
    { id: "water_shadow", type: "fill", paint: { "fill-color": "transparent", "fill-opacity": 1 } },
    {
      id: "road_minor_case",
      type: "line",
      minzoom: 13,
      maxzoom: 24,
      filter: ["==", ["get", "kind"], "residential"],
      paint: { "line-color": { stops: [[13, "#e6e6e6"], [16, "#ddd"]] }, "line-width": { stops: [[14, 2], [18, 14]] }, "line-opacity": 1 },
    },
    { id: "road_service_fill", type: "line", minzoom: 15, paint: { "line-color": "#fdfdfd", "line-width": { stops: [[15, 1], [18, 8]] } } },
    { id: "place_city_r5", type: "symbol", minzoom: 8, paint: { "text-color": "#697b89", "text-halo-color": "rgba(255,255,255,0.5)", "text-halo-width": 1 } },
    { id: "housenumber", type: "symbol", minzoom: 17, paint: { "text-color": "transparent", "text-halo-color": "transparent" } },
    { id: "custom_untouched", type: "line", paint: { "line-color": "#abcdef", "line-width": 3 } },
  ],
};

describe("recolorCartoStyle", () => {
  const light = recolorCartoStyle(fixture, "light");

  it("keeps attribution, zoom limits, filters, and non-color paint", () => {
    expect(light.sources.protomaps.attribution).toBe("© OpenStreetMap contributors © CARTO");
    expect(light.sprite).toBe(fixture.sprite);
    expect(light.glyphs).toBe(fixture.glyphs);
    const residential = light.layers.find((layer) => layer.id === "landuse_residential");
    const road = light.layers.find((layer) => layer.id === "road_minor_case");
    expect(residential?.minzoom).toBe(6);
    expect(residential?.filter).toEqual(fixture.layers[2].filter);
    expect(residential?.paint?.["fill-opacity"]).toEqual({ stops: [[6, 0.6], [9, 1]] });
    expect(road?.minzoom).toBe(13);
    expect(road?.maxzoom).toBe(24);
    expect(road?.paint?.["line-width"]).toEqual({ stops: [[14, 2], [18, 14]] });
    expect(road?.paint?.["line-opacity"]).toBe(1);
  });

  it("recolors sea, land, urban areas, and roads without flattening alpha", () => {
    const palette = BASEMAP_PALETTE.light;
    expect(light.layers.find((layer) => layer.id === "background")?.paint?.["background-color"]).toBe(palette.land);
    expect(light.layers.find((layer) => layer.id === "water")?.paint?.["fill-color"]).toBe(palette.sea);
    expect(light.layers.find((layer) => layer.id === "water_shadow")?.paint?.["fill-color"]).toBe("transparent");
    const cover = light.layers.find((layer) => layer.id === "landcover")?.paint?.["fill-color"] as { stops: [number, string][] };
    expect(cover.stops[0][1]).toBe("rgba(104, 139, 88, 0.5)");
    const urban = light.layers.find((layer) => layer.id === "landuse_residential")?.paint?.["fill-color"] as { stops: [number, string][] };
    expect(urban.stops[1][1]).toBe("rgba(231, 233, 223, 0.25)");
    expect(light.layers.find((layer) => layer.id === "road_service_fill")?.paint?.["line-color"]).toBe(palette.road);
    expect(light.layers.find((layer) => layer.id === "road_minor_case")?.paint?.["line-color"]).toEqual({
      stops: [[13, palette.roadCase], [16, palette.roadCase]],
    });
  });

  it("recolors labels and leaves unknown layers and transparent text alone", () => {
    const place = light.layers.find((layer) => layer.id === "place_city_r5");
    expect(place?.paint?.["text-color"]).toBe(BASEMAP_PALETTE.light.label);
    expect(place?.paint?.["text-halo-color"]).toBe("rgba(247, 251, 253, 0.5)");
    expect(place?.paint?.["text-halo-width"]).toBe(1);
    const numbers = light.layers.find((layer) => layer.id === "housenumber");
    expect(numbers?.paint?.["text-color"]).toBe("transparent");
    expect(light.layers.find((layer) => layer.id === "custom_untouched")?.paint?.["line-color"]).toBe("#abcdef");
    expect(fixture.layers.find((layer) => layer.id === "water")?.paint?.["fill-color"]).toBe("#d4dadc");
  });

  it("uses the night sea and land colors", () => {
    const dark = recolorCartoStyle(fixture, "dark");
    expect(dark.layers.find((layer) => layer.id === "water")?.paint?.["fill-color"]).toBe(BASEMAP_PALETTE.dark.sea);
    expect(dark.layers.find((layer) => layer.id === "background")?.paint?.["background-color"]).toBe(BASEMAP_PALETTE.dark.land);
  });
});
