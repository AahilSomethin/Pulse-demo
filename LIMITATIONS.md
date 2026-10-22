# Limitations

Each item is classified as resolved, partially resolved, blocked by data, or an inherent limitation. The system overview is [FLOW.md](FLOW.md).

## Resolved

- **Quoted FollowMe rows.** `device_date` and `timestamp` are quoted and can contain a comma in other exports. The parser splits quotes and stitches fields. A leading BOM is stripped.
- **Which clock is the observation.** `device_date` orders the map. `timestamp` is the database save time. It breaks ties and feeds the lag statistic. Median lag on the August extract is about 2 seconds.
- **Duplicate positions.** Exact repeats of device, time, latitude, and longitude are dropped and counted. Day 1 removed 6,090. The month removed 197,769.
- **Heading.** The field varies across the extract. It is shown as a tracker attribute. It is not a route.
- **Inferred areas versus places.** Dwell clusters use a 0.05° cell and the label “Inferred area”. They are not harbours, islands, or terminals. A named link is created only when both ends fall in a polygon that has a name.
- **Historical labelling.** Explore, Network, and Simulate state that positions are tracker reports, not live vessels and not a dispatch.

## Partially resolved

- **Real FollowMe in the app.** One daily file loads, plays, and matches the offline count for day 1 (435,033 kept rows, 1,432 devices). Previous and next day work in development against `data/FollowMe/FollowMe_august_2025`. The full month is not held in the browser. A production build does not serve those files; the user selects them.
- **Journey reconstruction.** Dwells and the passages between them are computed per loaded day. A passage whose straight-line speed exceeds 40 knots, or whose clock does not advance, is a coverage gap. A passage whose longest report gap exceeds 30 minutes is sparse. Both stay in the record and out of the typical time. Passages that cross midnight are in the August summary, which carries each vessel's open stop into the next file. The day view does not.
- **Route Lab.** The comparison is the pooled typical time, the middle half of times, the longer journeys when the sample allows, straight-line separation, and the tracked-path ratio. A typed duration is hypothetical. It is not a schedule and it is not a navigable path.
- **Month summary.** `data/derived/connectivity-august-2025.json` is built offline and gitignored. Redistribution of cell centres derived from the private extract was not confirmed. Development serves it. Production does not.
- **Emergency list.** Simulate explains historical positions, unverified speed, and the missing medical leg. A map click places an incident and ranks the straight-line options. On the synthetic fixture that list showed a Coast Guard estimate and two historical positions. It is still not a dispatch.
- **Light, dark, and small screens.** Both themes use the same semantic roles. Light and dark were both rendered. At 390px the workspace had no horizontal overflow and the canvas matched the map. A wider emulated width (960px) did the same. Browser zoom at 125%, 150%, and 200% was not measured.
- **Census 2022.** `data/Census 2022/P5.xlsx` is Maldives Bureau of Statistics Table P5, resident population by island and sex, 2022. `npm run data:census` checks that the 186 admin-island rows sum to the sheet total of 236,911 and writes `public/reference/census-2022.json`, including 9 Malé ward rows that are not part of that total. Against the current OpenStreetMap islands, 126 rows match (111 by a name that is unique on both sides, 15 by atoll and name), 12 duplicate names stay ambiguous, and 69 rows stay unmatched (61 of them admin islands). A conflicting atoll is not overridden by a unique name. There is no isolation score and no journeys-per-resident figure. Seven atoll boundaries (R, B, M, F, Th, L, Gn) had no geometry in the Overpass response, so duplicate names in those atolls cannot be separated.

## Blocked by data

- **Island and harbour names.** No national boundary file ships until `npm run data:reference` succeeds. Until then, clusters stay inferred. A downloaded OpenStreetMap name is only as good as that feature.
- **Hospitals and Coast Guard sites.** No verified medical or coast-guard layer is present. The evacuation leg stays off. A GeoJSON feature is used only when `kind` is `medical` and `verified` is true. SeaPulse does not check that claim against an authority.
- **MTCC workbook.** `data/MTCC/MTCC.xlsx` states that its passenger figures are randomly generated samples. It is not used.
- **Speed unit.** The file does not name the unit. Values are shown as recorded. The month median of values at or above 0.5 is 9, from a sample of up to 80,000. The month maximum is 770. Nothing is converted to knots.

## Inherent limitations

- **Coverage is the file.** 1,776 devices across August 2025 are the tracked set. They are not the Maldivian fleet. A place with no ping is not proof that it has no service.
- **Activity cells can split one island.** A 0.05° cell is about 5 km. Two cells on Thilafushi both received that island's name and a busy link between them. Short named links need a look at the map before they are read as a crossing. See [CONNECTIVITY_METHOD.md](CONNECTIVITY_METHOD.md).
- **Straight-line distance.** Hubs, journeys, Route Lab, and Emergency use straight-line distance. Reefs, channels, traffic, and waiting are not in the data.
- **Hubs are grid counts.** A hub is a cell of unique devices in the current window. One slow ping is enough. The cell is not a port.
- **Playback window.** The window is `[t − W, t + 1)`. The bold trail is `(t − W, t]`. The selected vessel bypasses the speed filter and still counts toward hubs. Those are the original rules. Above 1× the clock commits one sample per frame, so GPS reports between samples are not drawn.
- **Malformed time.** A timestamp that already includes `Z` or a numeric offset is rejected. The Maldives box is exclusive. The August extract had 0 bad times and 20,993 out-of-box rows.
- **Basemap.** Geography comes from the CARTO vector style (OpenStreetMap and CARTO attribution). SeaPulse recolors water, land, roads, and labels. The style has no bathymetry, and house numbers start above the map’s maximum zoom. If the style fails to load, the data layers still draw on a flat sea-coloured background.
