# SeaPulse UI/UX audit

Verified in the browser at `http://localhost:3000` on 22 October 2026, against the synthetic FollowMe fixture unless noted. The original HTML viewer and the Insight project were not modified.

## 1. Existing UI assessment

The app was five separate pages (Overview, Vessel Explorer, Sea Network, Emergency, Route Lab). Each page owned its own map, so changing section remounted MapLibre and dropped the feeling of one workspace. Hub cells had drifted away from the soft-fill-and-outline treatment of the original viewer. Playback was a single rate. Details lived in the page rather than next to the feature that was selected.

The analytical core was already in place: day-based FollowMe parsing, hub cells, dwells, inferred and named connections, and the historical response comparison. Those calculations were left as they were.

## 2. Identified usability issues

- Five routes repeated the same load, time, and map setup, and a section change rebuilt the map.
- The hub layer no longer matched the soft fill and outline of the recovered viewer.
- There was one playback rate, so a presentation could not move through a day without implying that every GPS report was being drawn.
- Selection, filters, and the clock were easy to lose because they were tied to the page that happened to be open.
- A details surface that closed also risked clearing the map selection.
- On small screens the controls competed with the map, and hiding them left no obvious way back.
- Opening `/routes` directly retriggered the network-tab update on every render. That loop is fixed: the reducer ignores a tab that is already selected, and the tab action keeps a stable identity.

## 3. Navigation changes

Three sections replace the five pages. Old addresses redirect with a temporary (307) rule:

| Old address | Now |
| --- | --- |
| `/` and `/explorer` | `/explore` |
| `/emergency` | `/simulate` |
| `/routes` | `/network?tab=routes` |

Explore holds the day loader, vessel search, and hub list. Network holds observed directions and Route Lab. Simulate holds the historical response comparison. The map, the loaded day, the cursor, the speed, and the open selection stay mounted across those three links. Confirmed in the browser: synthetic data, 8× speed, and 00:26 UTC survived Explore → Network → Simulate without a reload.

## 4. Sidebar and details-panel improvements

The sidebar has three modes: expanded (22rem), an icon rail (3.5rem / 56px), and hidden. Hidden shows a **Show panel** control. On viewports below the `lg` breakpoint the panel is a bottom sheet: a 56px bar when collapsed, and up to `min(62dvh, 36rem)` when expanded. Filters and the selected feature stay in memory in every mode.

The details card covers a vessel, an activity cell, a maritime connection, and a response scenario. **Close** hides the card and leaves the selection. **Show details** opens it again. The hub hover popup only says the unique-vessel count (`2 unique vessels` on the synthetic cell). The card holds the rest: time, reported speed marked unit-unverified, position, passage count, median, and the coverage-gap note.

## 5. Playback improvements

The bar stays under the map, including when the sidebar is hidden and in presentation view. It has play/pause, restart, the day control, a scrubber, the selected window, UTC and Maldives time (UTC+5), and speeds 0.25× Slow, 0.5× Reduced, 1× Normal, 2× Fast, 4× Very fast, and 8× Presentation speed.

1× still advances the historical clock by one sixth of the window every 90ms. Speed changes that clock only. It does not change a vessel’s reported speed. Above 1× the bar says the clock is sampled and that GPS reports between samples are not drawn. The scheduler commits one cursor per frame, parks on the end of the day, and wraps the unused remainder with modulo. It does not walk the pings inside a large jump. A hidden document does not accumulate time.

Confirmed with the page visible: 8× moved 00:12 UTC to the end of the synthetic day (01:20 UTC) and then wrapped (00:26 UTC). Scrubbing jumped to 00:00 UTC and paused. Restart returned to the initial cursor, 00:15 UTC / 05:15 MVT. The clock button swapped which zone is primary.

Keyboard, when focus is not in a field or button: Space plays and pauses, `P` toggles presentation view, `[` and `]` change speed, Escape leaves presentation view and then closes the details card.

## 6. Responsive design findings

- Desktop, about 1450px: no horizontal overflow. Hiding the sidebar grew the map container from 1098px to 1450px, and the canvas followed once the document was visible.
- 390×844: no horizontal overflow. The canvas matched 390px. Play and Restart stayed inside the viewport. **More** opens the day control and the speed control; the footer grew to 307px and still sat above the bottom edge without covering the header.
- An emulated width that settled at 960px: no horizontal overflow, canvas matched the map, collapsed sheet was a 56px bar at the bottom of the map area.
- Light background `rgb(243, 247, 251)` and dark background `rgb(7, 20, 34)` both come from the theme tokens. The theme and the sidebar mode persist in `localStorage`.

A dedicated pass at 125%, 150%, and 200% browser zoom was not run. The layout rules avoid fixed heights and keep scrolling inside the sidebar and the details card.

## 7. Map usability findings

One MapLibre map stays mounted for the whole workspace. Hub cells use the recovered soft fill (about 3–25% opacity) and a stronger outline. The hover popup is the unique-vessel count. Vessel dots, the selected trail, inferred links, and named-polygon links stay visually separate. An incident marker is red. A user-placed Coast Guard origin is amber. The layer menu can hide hubs, dots, the trail, islands, connections, and scenario overlays. Turning vessel dots off removed them from the legend; turning them back on restored them.

Map zoom changed the scale bar from 1 km to 500 m. Clicking the map in Simulate, with **Place incident** active, produced a ranked list: Synthetic Coast Guard at 4.8 km and 11 min (assumed 25), and two historical positions at about 6.6 km and 28 min (assumed 12, because those pings report under 1). The copy states that this does not dispatch a vessel.

Presentation view hides the header and the sidebar, keeps the playback bar, and leaves an Explore / Network / Findings switch on the map. Emergency Simulation stays in the Experimental menu.

## 8. Verified browser states

- `/` landed on `/explore`. `/explorer` landed on `/explore`. `/emergency` landed on `/simulate`. `/routes` landed on `/network?tab=routes` with Route Lab selected, and the page loaded instead of the update-depth error.
- Synthetic file: 3 devices, 16 pings, labelled synthetic. The hub list showed `4.170°, 73.510° · 2 devices`. The details card described a 15-minute stopped cell and said it is not a harbour.
- Vessel `111` opened a card titled Device (short ids are fully masked), observation `2024-01-01 00:15 UTC`, reported speed `0.2 (unit unverified)`, position `4.1750°, 73.5100°`. Closing the card kept the selection.
- Network showed one inferred direction and `Synthetic North → Synthetic South`, each with 1 passage, median 45 min, 6.8 km, and 0 coverage gaps. The card calls the cluster inferred, not a verified route.
- Light Simulate view: navy-and-white chrome, soft hub squares over the basemap, vessel dots, the playback bar, and the connection card. Dark mode then set the page background to `rgb(7, 20, 34)`.
- Collapsed rail was 56px wide and the form content was not shown. Presentation view removed the header and kept play plus the section switch. Escape restored the header.

## 9. Tests performed and results

| Check | Result |
| --- | --- |
| `npm test` | 32 passed (6 files), including playback jumps, workspace transitions, overlay ownership, redirects, hub opacity, and the local August day-1 count |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed. Static pages: `/explore`, `/network`, `/simulate`. `/api/dev-followme/[day]` stays dynamic |

Browser checks covered section changes, the details card, layer toggles, sidebar modes, presentation view, 8× playback and wrap, scrub, restart, the clock toggle, hub hover, vessel search, a map click in Simulate, light and dark, 390px and ~960px, map zoom, and the four redirects.

## 10. Remaining limitations

- Above 1×, playback commits one cursor sample per frame. Reports between those samples are not drawn. 1× is the original sixth-of-a-window step.
- The browser holds one day, plus one previous day in the cache. A full reload clears the in-memory day. Production does not serve the raw August files.
- Previous and Next day were disabled on the one-day synthetic file, so day changes were not re-checked against the August folder in this pass.
- Browser zoom at 125%, 150%, and 200% was not measured as a separate pass.
- Hubs, distances, and response times are straight-line. The speed unit is still unnamed. Named polygons are only as good as the GeoJSON the user loads. A cluster is not a harbour, and a simulated time is not a dispatch.
- The basemap still depends on the CARTO style. If that style fails, the data layers draw on a flat background.
