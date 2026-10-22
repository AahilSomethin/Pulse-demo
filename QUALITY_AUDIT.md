# SeaPulse quality audit

Audit date: 22 October 2026. Scope is the Next.js app in `seapulse`. Insight and the original HTML viewer were not modified. This report records what was measured. It is not a score.

## Executive summary

SeaPulse can load one real FollowMe day, reconstruct that day on the original hub and playback rules, and separate three kinds of evidence: tracker observations, inferred GPS activity areas, and hypothetical times. The August 2025 extract is 31 daily files, about 1.76 GB, 17,243,987 kept pings, and 1,776 devices. The browser holds one day. A second day is cached. The full month is summarised offline in `src/data/followme-quality.json`, which stores counts only.

The app analyses FollowMe tracks only. It is usable as a datathon demonstration of one historical day, with the limits below stated on screen. It is not a live operations picture, a harbour map, or a dispatch tool.

## Issues

### Critical

None confirmed. The parser no longer shifts columns on quoted FollowMe timestamps, and a real day matches the offline count.

### High

- The full month cannot be played in the browser. One day is about 0.4–0.7 million rows. Holding 17 million points was rejected on purpose.
- Reported speed has no documented unit. The screen shows the recorded number and says the unit is unverified. Values above 40 are kept and flagged. The month maximum is 770.
- No island, harbour, hospital, coast-guard, or census file is in `seapulse/data`. Named-island links and the medical evacuation leg stay empty until a GeoJSON file is loaded. Absence of a link is not treated as proof that an island has no service.
- Straight-line distance ignores channels and reefs. Emergency times are hypothetical. Positions are historical August 2025 reports.

### Medium

- About 151,677 consecutive ping pairs imply more than 40 knots. About 15,043 pairs share a `device_date` but not a position. Sampling gaps longer than 60 minutes exist (48,152 pairs). Trails still draw a straight line across a gap, matching the original viewer.
- Median interval and median moving speed in the month summary use a capped sample of 80,000 values. They are reproducible from that rule, not a sort of every gap.
- The development day loader (`/api/dev-followme/[day]`) returns 404 outside development. A production demo still needs the user to choose files.
- Map zoom and pan were not measured. An incident marker was placed; the ranked response list did not appear for that click, so that list was not confirmed in the browser.
- Keyboard-only use and a browser-console dump were not completed. The Next.js error overlay stayed closed, and the dev log showed successful day loads.

### Low

- Overview’s empty state previously added a second `h1` under the page title. The empty state on Overview is now an `h2`.
- The August corpus sentence ran the median speed into the jump count (`9.151,677`). A space and a one-decimal speed now separate them. Rechecked in the browser: “Median reported moving value 9.0. 151,677 implausible jumps.”
- On a 390px-tall layout the time bar sits against the bottom edge. Its last line measured inside the viewport (bottom 836 of 844). It was not clipped, but it is tight.

## Pages

### Overview

With 2 August loaded, the page showed 1,478 devices, 528,287 pings kept, 5,545 exact duplicates removed, and the span 2025-08-02 00:00 UTC to 23:59 UTC. Those counts match the offline day row. Copy says the counts are devices in the file, not the Maldivian fleet, and that positions are past reports. The corpus panel shows the 31-day totals and states that no device identifier or coordinate is stored in the summary.

### Vessel Explorer

A development action loads local August files and opens day 1. The loaded day showed 435,033 pings, 1,432 devices, hubs, a 15-minute window, and a CARTO basemap. Device labels in the list are masked. The isolate field still accepts a full identifier. Playback from day 1 advanced the clock from 00:15 UTC to 05:47 UTC and the control changed to Pause. Next day loaded 2 August (dev log: `GET /api/dev-followme/2` 200). The window at 00:15 UTC contained 611 devices.

### Sea Network

On day 1 the page reported 234 inferred areas and 190 directions. Copy says a cluster is not a harbour or a terminal, and that a missing link is not evidence of no service. Named polygons stayed empty because no island file is loaded. Day 1 had 0 dwell-to-dwell coverage gaps. That is a different count from the 151,677 ping-to-ping jumps in the month audit.

### Emergency intelligence

The page title and a warning say the dots are historical August 2025 observations, not boats that can respond now. Radius, fallback speed, and Coast Guard speed are labelled assumptions when the ping does not supply a usable reported value. With no verified medical feature, the page says no evacuation leg is added. Placing an incident drew an amber marker. The click did not produce a response card, so the ranked list and masked option labels were not confirmed on a click inside the radius.

### Route Lab

The default comparison is the busiest inferred pair on the loaded day. On day 1 that pair had 6 observed passages, a median of 1 h 16 min, a shortest-to-longest range of 12 min to 5 h 1 min, and a 5.3 km straight line. The straight-line reference was 17 min at the day’s median reported moving value of 10.0. The observed median was 59 min longer. The page says the reference ignores channels and waiting, and that extra time is not a measured delay. A typed 30 min value is labelled a hypothetical, not a schedule.

## Dataset compatibility

FollowMe columns, read from the files rather than from the filename: `poll_id`, `imei`, `timestamp`, `device_date`, `latitude`, `longitude`, `speed`, `heading`, `network`, `cellid`, `gsm_level`. Times are quoted. `device_date` is the observation clock. `timestamp` is the database save time and is used only to order ties and to measure lag. Median lag is about 2 seconds. About 1.8% of kept rows fall on a whole minute, so the file is not minute-quantised.

The parser is quote-aware, accepts the original headerless column positions, rejects timestamps that already carry `Z` or an offset, and drops exact duplicate device/time/position rows after sorting. Out-of-box rows and bad times are counted. Day 1 in the app parser matched the audit: 435,033 kept rows and 1,432 devices.

## Performance

| Step | Result |
| --- | --- |
| Offline pass over 31 files | 70,654 ms, 244,062 rows/s, 17,243,987 kept |
| App parser on day 1, Vitest | 5.2 s on the 22 October re-run (an earlier run in this audit took about 10.7 s). Both matched the audit counts |
| Dev server stream of day 2 | 1,111 ms to return the file; parsing continues in the browser |
| Heap after day 1 | about 46 MB `usedJSHeapSize` on the page that held the typed arrays |
| In-browser month | not implemented |

The day cache holds two datasets. Switching back to a cached day does not re-read it. Playback ticks on the original 90 ms / one-sixth-window rule and was observed to move the clock while day 1 stayed loaded.

## Colour, type, and layout

Tokens live in `globals.css`: ocean and cyan for maritime marks, teal for selection and named links, amber for warnings and hypothetical incidents, red only as a danger token. Map colours are the matching constants in `map-colors.ts` because MapLibre cannot read CSS variables. Light and dark both define the same roles.

Browser checks:

- Desktop, dark: Explorer, Sea Network, Route Lab, and Emergency with day 1 loaded. Historical labelling, inferred-area copy, and the Route Lab numbers above were visible.
- Light theme: `documentElement.dataset.theme` became `light`. Emergency used a light surface, dark text, and a teal primary button. Contrast of the warning banner was readable in the screenshot.
- 390×844: document scroll width matched the viewport (overflow 0). Controls stacked above the map. All primary nav items did not fit on one row; the row scrolls. Footer content ended inside the viewport.
- 768×1024: overflow 0. The map canvas measured 768px wide. All five navigation items were visible. Day 2 remained loaded.

Zoom at 125%, 150%, and 200% was not executed. The layout uses flexible widths, a `max-h` scroll region in the side panel, and `dvh` rather than a fixed page height.

## Accessibility

Skip link, primary navigation, labelled day select, timeline slider, and theme button are present. Device lists mask the identifier. Empty Overview no longer has two `h1` elements. A full keyboard pass and a screen-reader pass were not done. Focus rings use the existing control styles. The incident list’s live-region behaviour was not checked because that list did not render for the click that was tried.

## Fixes made in this audit

- Quote-aware FollowMe parsing, `device_date` ordering, save-time tie-break, duplicate drop, and quality counters.
- One-day load, previous/next day, and a development loader for the local August files. Raw files stay gitignored.
- Inferred activity areas on a 0.05° grid, labelled as clusters, never as harbours. Named links only when both ends have a polygon name.
- Route Lab comparison from observed count, median, range, distance, and the file’s median reported moving value. Typed minutes stay hypothetical.
- Emergency copy and evidence labels state historical August 2025 observations.
- Corpus sentence spacing, and a single `h1` on Overview.
- Map layer colours for inferred links, named links, and response lines.

## Remaining limits

Classified in `LIMITATIONS.md`. The ones that still block a stronger claim are the missing speed unit, the missing verified geography, channel-blind distance, and the decision not to hold the full month in the browser.

## Next steps

1. Add a verified island polygon file and a verified medical layer before naming places or drawing an evacuation leg.
2. Confirm the speed unit with the data owner before converting it.
3. Click an incident inside a busy cluster and record the response list.
4. Measure map zoom, pan, and a keyboard-only pass on the five pages.
5. If a month view is required, aggregate it offline. Do not pull every ping into the browser.

## Test results

Re-run on 22 October 2026 after connectivity indicators were added:

- `npm test` — 9 files, 52 tests passed, including `tests/connectivity.test.ts` and the local day-1 count check.
- Month aggregate row and device totals matched `src/data/followme-quality.json` (17,243,987 kept rows, 1,776 devices, 31 files).

Earlier audit notes below were written before this pass. The page list there is out of date: the app now prerenders `/explore`, `/network`, and `/simulate`.

- `npm test` — 2 files, 19 tests passed. `tests/maritime.test.ts` 18 tests in 42 ms. `tests/followme-day.test.ts` 1 test in 5.3 s. Total duration 6.41 s.
- `npx tsc --noEmit` — exit 0.
- `npx eslint src tests eslint.config.mjs` — exit 0.
- `npm run build` — exit 0. Next.js 16.4.2 compiled in 6.7 s and typechecked in 5.7 s. Static pages: `/`, `/explorer`, `/network`, `/emergency`, `/routes`. Dynamic route: `/api/dev-followme/[day]`.

## What was not verified

- Production mode of the day API (it is written to return 404; that response was not requested against `next start`).
- Map zoom level and pan.
- Ranked emergency options after a click that falls inside the radius.
- Keyboard-only operation and a captured browser console log.
- Browser zoom at 80%, 125%, 150%, and 200%.
- A second theme screenshot of Explorer, Sea Network, and Route Lab. Those three were inspected in dark theme with data. Emergency was inspected in light theme at mobile and tablet widths.
- Insight and the original HTML were left unchanged and were not retested.
