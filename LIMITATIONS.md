# Limitations

Each item is classified as resolved, partially resolved, blocked by data, or an inherent limitation.

## Resolved

- **Quoted FollowMe rows.** `device_date` and `timestamp` are quoted and can contain a comma in other exports. The parser splits quotes and stitches fields. A leading BOM is stripped.
- **Which clock is the observation.** `device_date` orders the map. `timestamp` is the database save time. It breaks ties and feeds the lag statistic. Median lag on the August extract is about 2 seconds.
- **Duplicate positions.** Exact repeats of device, time, latitude, and longitude are dropped and counted. Day 1 removed 6,090. The month removed 197,769.
- **Heading.** The field varies across the extract. It is shown as a tracker attribute. It is not a route.
- **Inferred areas versus places.** Dwell clusters use a 0.05° cell and the label “Inferred area”. They are not harbours, islands, or terminals. A named link is created only when both ends fall in a polygon that has a name.
- **Historical labelling.** Explore, Network, and Simulate state that positions are tracker reports, not live vessels and not a dispatch.

## Partially resolved

- **Real FollowMe in the app.** One daily file loads, plays, and matches the offline count for day 1 (435,033 kept rows, 1,432 devices). Previous and next day work in development against `data/FollowMe/FollowMe_august_2025`. The full month is not held in the browser. A production build does not serve those files; the user selects them.
- **Journey reconstruction.** Dwells and the passages between them are computed per loaded day. A passage whose straight-line speed exceeds 40 knots, or whose clock does not advance, is a coverage gap and is left out of the medians. Trails on the map still connect successive pings, including across a long gap, because that is the original viewer rule.
- **Route Lab.** The primary comparison is observed trip count, median duration, shortest and longest duration, median straight-line distance, and the time that distance would take at the file’s median reported moving value. A typed duration remains a labelled hypothetical. The comparison is not a schedule, and it is not channel-aware.
- **Emergency list.** Simulate explains historical positions, unverified speed, and the missing medical leg. A map click places an incident and ranks the straight-line options. On the synthetic fixture that list showed a Coast Guard estimate and two historical positions. It is still not a dispatch.
- **Light, dark, and small screens.** Both themes use the same semantic roles. Light and dark were both rendered. At 390px the workspace had no horizontal overflow and the canvas matched the map. A wider emulated width (960px) did the same. Browser zoom at 125%, 150%, and 200% was not measured.

## Blocked by data

- **Island and harbour names.** No national boundary or harbour file is in `seapulse/data`. GPS clusters are not used as a substitute.
- **Hospitals and Coast Guard sites.** No verified medical or coast-guard layer is present. The evacuation leg stays off. A GeoJSON feature is used only when `kind` is `medical` and `verified` is true. SeaPulse does not check that claim against an authority.
- **Census and demand.** No population file is present. Route Lab does not invent demand, fare, or fleet size.
- **Speed unit.** The file does not name the unit. Values are shown as recorded. The month median of values at or above 0.5 is 9, from a sample of up to 80,000. The month maximum is 770. Nothing is converted to knots.

## Inherent limitations

- **Coverage is the file.** 1,776 devices across August 2025 are the tracked set. They are not the Maldivian fleet. A place with no ping is not proof that it has no service.
- **Straight-line distance.** Hubs, journeys, Route Lab, and Emergency use straight-line distance. Reefs, channels, traffic, and waiting are not in the data.
- **Hubs are grid counts.** A hub is a cell of unique devices in the current window. One slow ping is enough. The cell is not a port.
- **Playback window.** The window is `[t − W, t + 1)`. The bold trail is `(t − W, t]`. The selected vessel bypasses the speed filter and still counts toward hubs. Those are the original rules. Above 1× the clock commits one sample per frame, so GPS reports between samples are not drawn.
- **Malformed time.** A timestamp that already includes `Z` or a numeric offset is rejected. The Maldives box is exclusive. The August extract had 0 bad times and 20,993 out-of-box rows.
- **Basemap.** Land outlines come from the CARTO style over the network. If that style fails to load, the data layers still draw on a flat background.
