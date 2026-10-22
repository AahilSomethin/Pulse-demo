# Connectivity method

SeaPulse turns FollowMe GPS reports into observed passages between places where a tracked vessel stopped. The question it can answer is which of those observed connections have enough repeated journeys to inspect, and which patterns in the journeys are uneven. It cannot say that an island has no transport.

## Journeys

For each tracked device the points are already in time order. `device_date` is the clock. `timestamp` only breaks ties.

A stop (dwell) is at least two reports with speed under 0.5, lasting at least 10 minutes, staying within 400 metres of the first point and of the previous point, with no gap over 20 minutes. The same rule as the day view. Speed is the number in the file. The unit is not documented and is not converted.

A passage is the movement from the end of one stop to the start of the next stop on the same device. The file keeps every passage. Flags record why a passage is weak:

- `clock_static` — the arrival does not start after the departure.
- `implausible_speed` — the straight-line speed is over 40 knots.
- `sparse_tracking` — the longest gap between reports on that passage is over 30 minutes.
- `same_area` — both stops fall in the same 0.05° activity cell.
- `same_island` — the stops are in different cells, and both fall in the same named island. The same polygon id matches. So does the same island name when the atolls do not conflict. The same name in two atolls stays a crossing. These passages stay in the record and leave the inter-island list, the map, and opportunity ranking.

Duration statistics use only passages with no flags. Flagged passages stay in the coverage count (`excluded`). They are not deleted.

The tracked path is the sum of ping-to-ping distances from the last point of the origin stop to the first point of the destination stop. The straight-line separation is between the two stop centroids. A path ratio near 1 means the reports ran about as far as the separation. A high ratio means the reports wandered, stopped, or the track is jagged. It is not a charted channel.

## Midnight

The month script keeps, per vessel, the open stop and the points accumulated since the last closed stop. The next day's points continue that state. A stop that begins before midnight and ends after it is one stop. A passage that departs on one day and arrives on the next is emitted once, when the arrival stop closes. Closing each day on its own drops that passage. That difference is covered in `tests/connectivity.test.ts`.

The loaded-day view still finishes the day on its own. Overnight passages appear in the August summary, not as two half journeys in the day panel.

## Connections

Passages are grouped by the 0.05° activity cell of each end. The cell centre is the coordinate. The cell is an inferred cluster, not a harbour.

If a reference file is loaded, a stop inside a named polygon is labelled with that name and marked `named_polygon`. A stop within 300 metres of a harbour, pier, or ferry-terminal point, and not inside a named polygon, is marked `near_harbour`. Otherwise the end stays `inferred`. The source id from the reference file is kept. Unmatched stops are not given an invented name.

## Indicators

For each direction:

- Journeys: credible passages only.
- Vessels: distinct devices on any passage between those cells, including flagged ones. The month file stores that count and cannot separate devices that appear only on flagged passages. A loaded day also reports how many of those devices have a credible passage. Evidence still uses the documented vessel count. Daily unique counts are not added up.
- Per observed day: credible journeys divided by the number of days in the window. The window length is shown beside the rate.
- Typical time: the median of the pooled credible durations.
- Middle half: the interquartile range, shown from 5 journeys upward.
- Longer journeys: the 90th percentile, shown from 10 journeys upward.
- Evidence: `adequate` from 8 journeys and 3 vessels, `limited` from 3 journeys and 2 vessels, otherwise `insufficient`.

Median, interquartile range, and 90th percentile use the type-7 linear quantile on one pooled list. The month file stores each credible duration in whole seconds. The app computes the quantiles from that list. It does not average daily medians. Rounding to a second is the only approximation, and it is applied before the quantile, not instead of pooling.

A small sample is labelled as a small sample. The typical time is still shown so the row can be inspected, and the spread is withheld until the minimum count is met.

## Opportunities

Find opportunities ranks only `adequate` connections. There is no single score and no population weight. A connection is listed when at least one rule fires. Rules, in `src/lib/analytics/opportunities.ts`:

- Journey times vary widely: interquartile range / median is at least 0.5, with at least 10 journeys.
- Longer than similar distances: minutes per kilometre is at least 1.5 times the median pace of other adequate connections in the same distance band (under 5 km, 5–15 km, 15–40 km, 40 km or more). The band needs at least 4 connections.
- Tracked path is long relative to the separation: median path ratio at least 1.8, with at least 5 journeys.
- Activity changes across days: coefficient of variation of daily counts, including zeros, is at least 1, and the window has at least 7 days. This uses the population standard deviation.
- Tracking gaps: at least 30% of passages between the cells were flagged, with at least 5 passages attempted.

Each rule stores the comparison it made and a planning question. The card also states that weather, vessel type, cargo, waiting, and GPS gaps can produce the same pattern. Connections below the evidence line are counted as held back and are not ranked.

## Route Lab

The baseline is the indicator above: journeys, vessels, typical time, middle half, longer journeys, a 15-minute histogram of the pooled durations, straight-line separation, and path ratio. The user types a hypothetical direct time. The page reports the difference from the typical time and, when the sample is large enough, from the longer journeys. It lists the evidence a planner would still need: a navigable path, vessel class and a verified speed, how much of the time is waiting or a tracking gap, and any schedule or demand collected elsewhere. The straight line is not described as navigable.

## Reference data

`npm run data:reference` queries public Overpass mirrors for named `place=island` and `place=islet` polygons, and for named harbour nodes, ferry terminals, and named piers in the Maldives. Results are written to `public/reference/` with an ODbL attribution file. If the download fails, the app keeps inferred clusters and says so.

`npm run data:census -- path/to/census.csv` expects `name` (or `island`) and `population` columns, with optional `code` and `atoll`. Rows join on island code first, then on a normalised exact name. Near-spellings stay unmatched. Population is shown next to a named place. It is not turned into journeys per resident.

No census table is bundled. `src/lib/analytics/population.ts` remains the empty adapter for callers that do not have a table.

`data/MTCC/MTCC.xlsx` says its passenger figures are randomly generated sample values. SeaPulse does not read it.

## Month file

`npm run data:connectivity` reads `data/FollowMe/FollowMe_august_2025` one day at a time and writes `data/derived/connectivity-august-2025.json`.

The file is gitignored. The extract is private, the published coordinates are activity-cell centres from those tracks, and redistribution was not confirmed. In development, Network reads it from `GET /api/dev-connectivity`. Production returns 404. A day result and a month result are labelled separately.

Connections with fewer than 3 distinct vessels are omitted from the file so the local summary is limited to repeated observations. The script prints its row and device totals next to `src/data/followme-quality.json` and warns if they differ.

## Reproducibility

Thresholds live in `CONNECTIVITY` in `src/config/constants.ts`. The month file records the dwell and speed thresholds it used, the day files it read, and the quantile method. Tests in `tests/connectivity.test.ts` cover midnight carry, pooled medians, the minimum sample for the 90th percentile, opportunity ranking, polygon and harbour matching, and the census join. They use synthetic points only.

## Demonstration findings

Built from `data/FollowMe/FollowMe_august_2025` on 22 October 2026. The script's kept rows (17,243,987) and devices (1,776) match `src/data/followme-quality.json`. OpenStreetMap contributed 658 named island polygons and 56 harbour points. 766 directions had at least 3 vessels. 151 of those cleared the evidence bar and at least one investigation rule. 587 were held back. Place names below are the OpenStreetMap names on the matched polygon, including Dhivehi names. They are not an official census spelling.

The connection with the most rules (11 journeys, typical time about 8 hours, 5 km apart) is not used as a demonstration. The sample is at the minimum and the duration is not distinguishable from waiting or missed stops.

1. **Repeated crossing, uneven return.** August 2025. FollowMe, dwell-to-dwell passages, pooled seconds. Vihamanaafushi to the Funadhoo cell (`ފުނަދޫ`, about 4.17°N, 73.53°E): 330 credible journeys, 189 vessels, typical time 24 minutes, middle half 24 minutes, longer journeys 77 minutes, separation 5.3 km, tracked path 1.31× that separation. 240 further passages were flagged and left out of the times. The opposite direction has 166 credible journeys, typical time 42 minutes, longer journeys 189 minutes, and 211 flagged passages. Question worth a planner's time: why the two directions of this short, busy crossing do not look alike, and how much of the missing track is a GPS gap rather than time alongside.

2. **A repeated longer crossing with steadier tracking.** The Male'-area cell near Jetty coverage (about 4.17°N, 73.53°E, harbour match) to Maafushi: 189 credible journeys, 22 vessels, typical time 54 minutes, middle half 25 minutes, longer journeys 84 minutes, separation 26.3 km, tracked path 1.11× the separation, 8 passages excluded. The spread stays under the variability rule, so it is not flagged. It is the example of an observed connection that is repeated often enough to describe. It is still not a ferry timetable, and 22 tracked vessels are not the fleet.

3. **Same-island cells are not a route.** Two neighbouring 0.05° cells that both match Thilafushi (`ތިލަފުށި`) showed 106 and 102 journeys in the August build, a tracked path more than twice the 1.1 km cell separation, and a high share of flagged passages. That pattern is movement around one island. The app now reclassifies a pair like that: the passages stay counted, and they are not listed, mapped, or ranked as an inter-island connection. The cross-island examples above are unchanged by that rule.

No census table was available, so none of these findings uses population.

