# Visual audit

SeaPulse keeps one MapLibre map and one set of semantic tokens. This pass recolors the existing CARTO basemap and aligns the interface with it. Hub opacity, playback stepping, and the analysis modules are unchanged.

## Previous issues

- Positron water was `#d4dadc` and Dark Matter water was `#2C353C`. Islands and sea were close in value, especially at night.
- Hub fill, vessel dots, and the selected trail shared too few colours. The legend painted hubs and vessels with the same swatch.
- The light map scrim was a translucent navy with dark text, so the legend and attribution were the weakest pair.
- Vessel dots had no stroke, so they disappeared once the sea became blue.

## Colour system

Tokens live in `src/app/globals.css`. MapLibre copies the same roles in `src/config/map-colors.ts` because paint cannot read CSS variables.

Light interface text uses `#193348` on white. The maritime blue is `#087EA4`. Vessels are `#075CC4`. Selection and connectivity stay in the teal range (`#0F766E` and `#00766C`). Warning and danger marks are `#9A6410` and `#C53636`.

Those warning, danger, and selection values are darker than the first suggested hues. The suggested `#D28A19`, `#D94B4B`, and `#0D9488` did not clear WCAG AA for text on white, and the lighter marks were weak on `#B9E1EF` water. Dark mode uses lighter variants of the same roles (`#E0A44A`, `#F08A82`, `#2DD4BF`) on navy surfaces.

`tests/visual-contrast.test.ts` checks foreground, secondary, muted, primary, ocean, cyan, selected, warning, and danger text against their surfaces in both themes. Each of those pairs measured at least 4.5:1. That is not a full WCAG audit of every control.

## Basemap

The styles are still the free CARTO Positron and Dark Matter vector styles. `src/lib/map/basemap.ts` fetches the style, keeps attribution, sprites, glyphs, filters, zoom limits, widths, and opacities, and replaces colour paint only. Transparent values stay transparent.

Light sea is `#B9E1EF`. Light land is `#7A9A68`, not the suggested `#C7D9B2`. Those two suggested colours were about 1.1:1 apart, so islands did not separate from the ocean. The sage land is about 2.3:1 against the sea and still reads as green. Vegetation patches and residential areas keep the style’s own alpha stops. Dark sea is `#102D40` and dark land is `#395C57`. Roads keep their casings: light casings are `#5C6B62` so a road on water still has an edge.

The style has no bathymetry. Land cover is only where OpenStreetMap already tags wood, grass, or parks. Buildings appear from zoom 13. Road names appear from about zoom 13. House numbers start at zoom 17, and the map stops at 16, so they never draw. Place labels stay above hub fills.

If the style request fails, the map keeps a flat sea background and the data layers still draw. A later theme change can try again.

## Overlay meaning

- Historical track: solid maritime blue. The faint line is the whole day. The bolder line is the current window.
- Vessel dots: royal blue with a contrasting stroke. Radius grows slightly with zoom and stays small at nationwide scale. The selected dot is larger and teal.
- Activity hubs: the same 3% to 25% fill curve. Light cells use `#087EA4` with a `#0E4F6C` outline. Hover and selection thicken the outline. The tooltip is the unique vessel count.
- Inferred connections: dashed teal.
- Named places: solid teal, and only when both ends have a loaded name.
- Estimated response: longer dashed red. The incident marker is red. The assumed origin is amber.
- Loaded island polygons are a 35% tint so they do not cover basemap roads.

The legend uses a dot, a solid sample, or a dashed sample with the label, so the classification is not colour alone.

## Browser check

Checked in the running app with local FollowMe day 1 (435,033 kept pings, 1,432 devices).

- Nationwide dark view at zoom 6: the atoll chain, India, and Sri Lanka stay separate from the sea. Vessel dots stay small. Light nationwide uses the same separation with green land on `#B9E1EF` water.
- Malé around zoom 12.8 and 14, both themes: street grid, urban blocks, vegetation, coast, and the airport road stay readable. Hub fill stays translucent over the island.
- Hulhumalé in the same Malé frame: urban blocks, roads, and the airport read against the sea.
- Theme changes kept the camera. Dark Matter loaded at longitude 73.509, latitude 4.175, zoom 12.8. Switching back to Positron at the nationwide view kept longitude 73.5, latitude 3.2, zoom 6. Moving between Explore, Network, and Simulate kept that camera and the loaded day.
- A click on a vessel dot opened the details card for a masked device (`••••2613`) and kept the day trail. Hub selection from the list and from the map still opens the unique-vessel count.
- Network shows dashed inferred connections. Simulate shows the incident, origin, and estimated-response legend samples. Named-place links stay solid and appear only when both ends have a loaded name. No island file was loaded in this check, so that list stayed empty.
- The playback bar shows UTC and MVT, a blue window band, and a labelled speed control.
- At 375px CSS width the page did not scroll horizontally. Checks at 960px, 1492px, and 1600px also had no horizontal overflow. The embedded browser did not lock 768px, 1280px, or 1920px exactly.
- CARTO and OpenStreetMap attribution remain on the map. The live dark style still had the water filter, land-cover filter, road width expression, and house-number zoom range.

## Remaining limits

- No bathymetry, and no invented vegetation or buildings.
- Road detail depends on the CARTO tiles and on zoom.
- The basemap needs the CARTO CDN. The flat sea fallback has no coastlines.
- UI text pairs above were measured. Map lines were checked by eye and by luminance separation, not as WCAG text.
