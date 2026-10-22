<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Routine debugging is not feedback. Verify changes before retaining them as feedback candidates. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Retain qualifying friction even if it is later fixed or worked around; record the final outcome during the reporting pass.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `npx --no-install next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->

# SeaPulse agent notes

SeaPulse is the project to change. It is a browser-only dashboard for historical FollowMe vessel tracks around the Maldives. It replays one loaded day, shows activity cells, infers dwell-to-dwell connections, and compares hypothetical times against those historical positions. It is not a live tracker and it does not dispatch vessels.

Read [FLOW.md](FLOW.md) for the pipeline, [IMPLEMENTATION.md](IMPLEMENTATION.md) for module behaviour, and [LIMITATIONS.md](LIMITATIONS.md) for what the files cannot support. [README.md](README.md) covers setup and the three sections.

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, MapLibre GL with `react-map-gl`, and Vitest. Parsing and analysis run in the browser. There is no database and no maritime API.

## Layout

```
src/app/layout.tsx                 Theme, Maritime, and Workspace providers
src/app/(workspace)/               /explore, /network, /simulate
src/app/api/dev-followme/[day]     development-only stream of one local day
src/components/layout/             shell, sidebar, map stage, details drawer
src/components/map/                MapLibre map, loaded without SSR
src/components/explore|network|simulate|vessels
src/context/                       dataset and playback, workspace UI, theme
src/lib/parsing/                   CSV, GeoJSON, day order
src/lib/vessels/                   typed arrays, windowed frame, playback
src/lib/analytics/                 dwells, journeys, links, census-backed population lookup
src/tour/                          Team Guide steps, Driver.js, visible-target wait
src/lib/simulation/                emergency comparison and Route Lab
src/lib/workspace/                 sidebar state and map overlay store
src/workers/parse-csv.ts           same parser off the main thread
src/config/                        constants, map colours, old-route redirects
src/data/followme-quality.json     August counts only
public/fixtures/                   labelled synthetic CSV and GeoJSON
data/FollowMe/                     gitignored raw tracks
tests/                             Vitest
```

Pages only render a panel. `WorkspaceShell` stays mounted and owns the sidebar, the map, the details card, and the playback bar.

## State

`MaritimeContext` holds the loaded day and splits playback into two contexts. Settings (window, hub mode, cell size, speed filter, selection, play, speed) are separate from the clock (`cursor` and the current frame). Panels that do not need the frame should use `useDataset` or `usePlaybackSettings`, not `usePlaybackClock`.

The provider keeps the active day and one previous day in a `Map`. Switching sections must not clear or reparse that cache.

`WorkspaceContext` is an external store for the sidebar, details card, layer toggles, presentation view, clock zone, and the Explore / Network drafts. The first client snapshot matches the server. Stored sidebar, layers, and clock zone are applied in a microtask so hydration stays stable. Do not read `localStorage` during the first render.

Section-specific markers and lines go through `publishMapOverlay` in `src/lib/workspace/overlay.ts`, via `useMapOverlay`. A release carries the token from its own publish. A newer section must survive the previous section’s cleanup.

## Map

`MapStage` renders one `SeaMap`. `SeaMap` dynamically imports `SeaMapInner` with `ssr: false`. The map instance stays alive across `/explore`, `/network`, and `/simulate`. Update sources and layer visibility. Do not remount the map to change a panel, a layer, or the playback cursor.

The worker URL is `/vendor/maplibre/maplibre-gl-worker.mjs`. `predev`, `prebuild`, and `postinstall` copy it. Do not commit `public/vendor/`. The basemap is CARTO Dark Matter or Positron, recolored in `src/lib/map/basemap.ts`. Zoom limits, filters, and non-color paint stay as published. If that style fails, data layers still draw on a flat sea-coloured fallback. A `ResizeObserver` on the map container handles sidebar width changes.

## FollowMe and privacy

Users load a CSV in the browser. In development, `GET /api/dev-followme/[day]` streams `data/FollowMe/FollowMe_august_2025/{1-31}.csv` and returns 404 in production. The raw directory is gitignored.

Do not commit raw tracks, device identifiers, or coordinates from the extract. `src/data/followme-quality.json` and `src/lib/analytics/corpus.ts` store counts only. Mask IMEIs in the UI. `public/fixtures/` is synthetic and must stay labelled as synthetic.

`device_date` is the observation clock. `timestamp` is the database save time and only breaks ties. A value with no zone is UTC, matching the August extract. A value that already has `Z` or a numeric offset keeps that instant. The reported speed unit is not in the file. Do not convert it. The 0.5 stop threshold uses the recorded number. The 40-knot gate uses straight-line distance over time.

## Observed, inferred, simulated

- **Observed.** Parsed ping time, latitude, longitude, reported speed, heading, network, and IMEI. Dwell-to-dwell counts, durations, and straight-line distances are summaries of those pings.
- **Inferred.** Hub cells, dwells, 0.05° activity areas, and the links between them. An activity cell is not a harbour or an island. A named link exists only when both ends fall in a polygon that has a name. Two cells on the same named island are not an inter-island connection. Search results for those cells stay labelled inferred.
- **Simulated.** A map-clicked incident, an optional user-placed Coast Guard origin, a typed Route Lab duration, and straight-line times at assumed or unverified speeds. Label them as hypothetical. They are not a schedule and not a dispatch order.

Hub rules differ from dwell rules. A hub ping is reported speed under 0.5 in the window `[t - W, t + 1)`. A dwell needs at least two slow pings, 10 minutes, 400 metres, and no gap over 20 minutes. The bold trail is `(t - W, t]`. Keep those edges.

A journey whose implied straight-line speed is above 40 knots, or whose clock does not move, is a coverage gap. A passage with a report gap over 30 minutes is sparse. Both stay out of duration statistics and stay in the coverage count. The month aggregate carries an open dwell across midnight. Do not close that state per file.

The August connectivity file under `data/derived/` is gitignored. It stores activity-cell centres and passage durations from a private extract. Do not commit it unless redistribution is explicitly allowed. Count-only quality figures in `src/data/followme-quality.json` are the committed aggregate.

## Conventions

Keep pages and components thin. Maritime calculations live in `src/lib` and take plain data, so Vitest can run them without React. Use the `@/` alias.

Style with the semantic tokens in `src/app/globals.css` (`bg-surface`, `text-fg-muted`, `border-border`, and the same family). MapLibre paint values belong in `src/config/map-colors.ts`. Support light and dark through those tokens, not theme branches in components.

Changing a threshold, window edge, distance, or sort requires a test in `tests/` and a matching note in `IMPLEMENTATION.md` or `LIMITATIONS.md` when the user-facing meaning changes.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

`tests/maritime.test.ts` uses synthetic rows. `tests/followme-day.test.ts` parses local day 1 only when that file is present and checks counts, not identifiers.

## Do not modify

- `insight/` — reference only.
- `Maldives vessel hubs over time (1).html` in the parent directory — Rida’s original viewer.
- `data/FollowMe/` — private raw tracks. Do not add them to git.
- `data/derived/` — local connectivity summary. Do not add it to git unless redistribution of the derived cell centres is confirmed.
- Analytical formulas in `src/lib`, unless the change is validated and tested.
- The Next.js blocks at the top of this file. `next dev` restores them.

## Pitfalls

- Remounting `SeaMap`, or parsing the CSV again on every section change, drops the camera and repeats a large parse.
- Subscribing a static panel to the playback clock rerenders it on every tick.
- Releasing an overlay without its token clears a section that just published.
- Playback above 1× commits one sample per frame. It does not draw the GPS reports inside the jump. The clock pauses while `document.hidden` is true.
- Census population is shown only after an atoll-and-name or unique-name match against Table P5. Do not invent a match, a demand figure, or an isolation score. Ambiguous names stay blank.
- Team Guide targets use `data-tour` on a visible element. The guide is started from the header. It does not auto-start and it does not store progress. Steps cover search, island selection, vessel frequency, and the connectivity report, and fall back to centred text when that data is absent.
- Header search does not render the device list. Vessel hits need at least four characters and show a masked id. Do not export IMEIs, trajectories, or connection coordinates. The August connectivity file stays gitignored until redistribution is allowed.
- Census population on a profile says whether the match was atoll and name, a unique name, or an official code. Do not collapse those into one confirmation.
- No verified medical or Coast Guard file ships with the app. An evacuation leg runs only when a loaded feature has `kind: "medical"` and `verified: true`.
- Old paths redirect in `src/config/redirects.ts`: `/` and `/explorer` to `/explore`, `/emergency` to `/simulate`, `/routes` to `/network?tab=routes`. Emergency Simulation stays at `/simulate` and opens from the Experimental menu, not as a third primary section.
