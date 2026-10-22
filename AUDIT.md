# SeaPulse audit

Audited on 22 October 2026. SeaPulse was an untouched `create-next-app` scaffold (Next.js 16.4.2, React 19, Tailwind 4). The vessel viewer is the single file `Maldives vessel hubs over time (1).html` in the parent directory. Insight was inspected and not modified.

## Original viewer

The HTML file is 114 lines. It is a canvas 2D viewer with no Leaflet, MapLibre, or tile basemap. Sea and land are painted fills. The projection is equirectangular, corrected by `cos(latitude)` at the data centre.

### CSV

Named headers, case-sensitive: `imei`, `device_date`, `latitude`, `longitude`, `speed`. If `device_date` is missing, the reader falls back to column indexes 1, 3, 4, 5, and 6 and treats the first line as data.

- Split is a plain comma split. Quoted commas are not supported.
- A row is kept only when latitude is inside `(-0.8, 7.2)` and longitude is inside `(72.5, 73.9)`. The edges are excluded.
- Time is `Date.parse` after the first space becomes `T` and a `Z` is appended. Values are therefore read as UTC. A value that already has a zone suffix becomes invalid and is dropped.
- Speed uses `+value || 0`. Empty and non-numeric speeds become 0. Negatives are kept. The original labels this number as knots and does not convert it.
- Rows are sorted by time. Device indexes are assigned in first-seen order after that sort.
- Missing IMEI collapses onto the string `"undefined"`.

### Playback and hubs

The window end is `t`, and the included pings are `[t - W, t + 1)` milliseconds. There is no interpolation. Each vessel marker is the last raw ping in that window.

The original slider has 1,001 integer steps. Each play tick adds `1000 * (W / 6) / span` and runs every 90 ms. When the file is longer than about 1.7 days at a 15-minute window, that step is below 1 and the slider never moves. SeaPulse keeps the same time step (`W / 6` every 90 ms) on a millisecond cursor so long files still advance.

Stopped, for the hub grid, means reported speed under 0.5 knots on that ping. There is no dwell test in the hub score. Cells are `floor(lon / cell)` and `floor(lat / cell)`. The score is the count of unique devices. The top five cells are a stable sort by that count, with no minimum. Default window is 15 minutes, default mode is stopped devices, default cell is 0.02 degrees.

"Min peak speed" does not use a peak. Zero disables the filter. Any other value keeps devices with at least three pings, anywhere in the file, at or above the threshold. The selected vessel stays visible and still enters the grid.

The bold trail uses `(t - W, t]`, which is not the same edge rule as the hub window. SeaPulse preserves that difference.

### GeoJSON and interaction

Polygon and MultiPolygon rings are filled. Points, lines, and other geometries are ignored for land. Islands are not drawn until a CSV has produced bounds, and the camera fits the track extent rather than the islands. Drag pans, the wheel zooms, and a click within 12 pixels selects a vessel. Resize resets the canvas camera. `data-theme` exists in the CSS, but no control sets it; the page follows the operating system.

## Insight

Useful patterns, copied in adapted form:

- MapLibre worker copy (`insight/scripts/copy-maplibre-worker.mjs`) and `setWorkerUrl`.
- CARTO dark-matter basemap, with positron used for the light theme, plus a solid fallback style.
- Semantic colour tokens and a full-height shell with an internal scrolling side panel.
- Equirectangular distance, rewritten locally so SeaPulse does not import Insight.

Not copied: Greater Malé road, bus, outbreak, airport, and AI modules; demo population rectangles; the ferry simulator. That simulator needs a road graph and assumed headways. Recharts is installed in Insight and unused. No census file exists.

## SeaPulse before this work

`app/page.tsx` was the default Next.js starter. There was no map library, no parser, and no dataset in the workspace.
