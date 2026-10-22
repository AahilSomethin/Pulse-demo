# Implementation

SeaPulse lives under `src/`. The original HTML file and the Insight project are untouched. The short system overview is [FLOW.md](FLOW.md). Agent constraints are in [AGENTS.md](AGENTS.md).

## Modules

- `src/lib/parsing/csv.ts` — quote-aware CSV, named FollowMe headers or the original positional columns, UTC parsing, and duplicate detection.
- `src/lib/parsing/days.ts` — daily file order and titles.
- `src/lib/vessels/dataset.ts` — time-sorted typed arrays, per-device tracks, and day quality.
- `src/workers/parse-csv.ts` — same parser off the main thread. The worker accepts text or a file and transfers the typed-array buffers. If it cannot start, the caller uses the same function directly.
- `src/lib/vessels/frame.ts` — window `[t - W, t + 1)`, last ping per device, speed mask, hub grid, and the `(t - W, t]` trail.
- `src/lib/parsing/geojson.ts` — land polygons, plus medical and Coast Guard sites.
- `src/lib/analytics/journeys.ts` — dwells and inferred activity cells.
- `src/lib/analytics/passages.ts` — the same dwell rule with path length, quality flags, and a carry across midnight.
- `src/lib/analytics/connectivity.ts` — pooled indicators. Median, interquartile range, and 90th percentile come from one duration list.
- `src/lib/analytics/opportunities.ts` — evidence gate and separate investigation rules. No combined score.
- `src/lib/analytics/network.ts` — named directions and inferred-area directions. Credible passages only.
- `src/lib/analytics/month.ts` — reads the local August summary and recomputes quantiles from stored seconds.
- `src/lib/reference/census.ts` — exact code or name join. No fuzzy match.
- `src/lib/analytics/population.ts` — empty census adapter when no table is loaded.
- `src/lib/simulation/routes.ts` — observed baseline, histogram, and a hypothetical typed duration.
- `src/app/api/dev-connectivity/route.ts` — development-only read of `data/derived/connectivity-august-2025.json`.
- `scripts/aggregate-connectivity.ts` — one-day-at-a-time month summary. Gitignored output. No device identifiers.
- `src/app/api/dev-followme/[day]/route.ts` — development-only stream of one local day. Other environments return 404.
- `src/components/map/SeaMapInner.tsx` — MapLibre layers for land, hubs, vessels, trails, inferred links, named links, and scenario lines. The CARTO style is recolored in `src/lib/map/basemap.ts` without changing its zoom limits or filters.
- `scripts/audit-followme.mjs` — rebuilds the committed August summary. It does not write tracks or device identifiers.

## Workspace

`src/app/(workspace)/layout.tsx` mounts one shell. Explore, Network, and Emergency Simulation (`/simulate`, opened from the Experimental menu) only swap the sidebar and the markers published through `src/lib/workspace/overlay.ts`. A hidden section releases its overlay with a token, so a newer section is not cleared when the previous effect cleans up. `next.config.ts` applies the temporary redirects in `src/config/redirects.ts`.

`MaritimeContext` splits settings (window, speed, selection, playing) from the clock (cursor and frame). Panels that do not need the frame avoid subscribing to every tick. `WorkspaceContext` is an external store for the sidebar, details card, layers, presentation view, and the clock zone. The first client snapshot matches the server until a microtask applies `localStorage`, so a stored sidebar mode does not break hydration.

`src/lib/vessels/playback.ts` turns wall time into one timeline step. 1× commits every 90 ms and advances by `window / 6`. Faster speeds commit no sooner than 33 ms. `advancePlayback` returns a single cursor. A step past the end of the day stops on that timestamp and returns the unused remainder; the next commit wraps that remainder with modulo. It does not emit the GPS reports inside the jump. The animation frame ignores time while `document.hidden` is true. `advanceCursor` in `frame.ts` is unchanged.

Hub paint is `src/lib/vessels/hub-style.ts`: soft fill from 3% to a 25% cap, with a separate outline. Loaded island polygons are a 35% tint so they do not hide the basemap roads. The map resizes from a `ResizeObserver` on its container after the sidebar changes width. Historical trails are solid. Inferred links are dashed. Named-place links are solid. Estimated response lines use a longer dash.

Playback stores a millisecond cursor. The context keeps the active day and one previous day.

## What is raw

Ping time, latitude, longitude, reported speed, heading, network, and IMEI are stored as parsed. Hub cells, the speed mask, and the current-window marker are the original definitions:

- Stopped hub ping: reported speed under 0.5.
- Cell score: unique devices in the window, not ping density.
- Speed filter: at least three pings in the whole file at or above the threshold. Zero disables it. The selected vessel is exempt and still affects hubs.
- Top five cells: stable sort by device count. The label is the cell centre to three decimals.

Reported speed is not converted. The unit is not in the file.

## What is inferred

Dwells are a separate layer. A dwell is at least two slow pings spanning 10 minutes, staying within 400 metres, with no sample gap over 20 minutes. Each dwell also carries an activity-cell id from a 0.05° grid. A journey is the time and straight-line distance from the end of one dwell to the start of the next on the same device. The passage also stores the summed ping-to-ping path, the longest internal gap, and flags. A gap over 30 minutes is sparse tracking. If the implied speed is above 40 knots, or the clock does not move, the jump is a coverage gap. Flagged passages stay on record and stay out of the duration statistics.

The month script does not close a vessel's state at midnight. See [CONNECTIVITY_METHOD.md](CONNECTIVITY_METHOD.md).

Island names come only from a loaded GeoJSON or from the OpenStreetMap reference file when that download succeeded. A point within 300 metres of a harbour point is labelled near a harbour. An activity cell is never promoted to an island.

## Emergency comparison

For a map-clicked incident the page lists:

- Up to five historical positions inside the chosen radius. Speed is the reported ping when it is at least 1, otherwise the assumed vessel speed.
- Every loaded Coast Guard point. `verified: true` is labelled verified. Anything else is labelled unverified.
- An optional Coast Guard origin the user places on the map. That origin is hypothetical.

If a medical feature is marked verified, each option adds a second straight-line leg from the incident to the nearest such site, at the same speed used for the first leg. The list is sorted by that combined estimate. The sort is not a dispatch order. The page states that the dots are August 2025 reports.

## Route Lab

Route Lab uses the selected connection's pooled durations: journey count, vessels, typical time, interquartile range from 5 journeys, 90th percentile from 10, a 15-minute histogram, straight-line separation, and the tracked-path ratio. A typed duration is the difference from that typical time. The page lists the evidence still required before anyone could treat the difference as a saving. The straight line is not a route.

## Checks

`tests/connectivity.test.ts` covers midnight carry, pooled quantiles, opportunity rules, spatial matching, harbours, and the census join. `tests/maritime.test.ts` covers quoted FollowMe rows, duplicates, activity areas, the hub cell, hub opacity, the speed mask, dwell journeys, the response comparison, and the route reference, using synthetic rows. `tests/playback.test.ts` covers the speed step and large end-of-day jumps. `tests/workspace-state.test.ts` covers the details card, the sidebar, and a repeated network-tab update. `tests/overlay.test.ts` covers a newer section surviving an older release. `tests/redirects.test.ts` covers the compatibility redirects. `tests/followme-day.test.ts` parses local day 1 when that file is present and checks the kept-row and device counts against `src/data/followme-quality.json`. It does not embed a device identifier. `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` are the project checks. The production build prerenders `/explore`, `/network`, and `/simulate`. The day route is dynamic and is not available in production.
