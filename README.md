# SeaPulse

SeaPulse is a browser-only maritime dashboard for FollowMe vessel tracks. It migrates the original Maldives hub viewer into Next.js and adds inferred activity areas, a historical response comparison, and a data-derived route comparison.

Tracker files are parsed locally. A development-only route can read one local August day. Production does not serve those files.

How the pieces connect is in [FLOW.md](FLOW.md). Module behaviour is in [IMPLEMENTATION.md](IMPLEMENTATION.md). Data limits are in [LIMITATIONS.md](LIMITATIONS.md). Notes for coding agents are in [AGENTS.md](AGENTS.md).

## Setup

```bash
cd seapulse
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other commands:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run data:reference
npm run data:connectivity
npm run data:census
npm run data:census-match
```

`npm install`, `npm run dev`, and `npm run build` copy the MapLibre worker into `public/vendor/maplibre`.

## Load data

1. Open **Vessel Explorer**.
2. Choose one FollowMe CSV, or a folder of daily files. Named columns are `poll_id`, `imei`, `timestamp`, `device_date`, `latitude`, `longitude`, `speed`, `heading`, `network`, `cellid`, and `gsm_level`. A headerless export is also accepted: IMEI, time, latitude, longitude, and speed must sit in columns 2, 4, 5, 6, and 7.
3. `device_date` is the observation clock. `timestamp` is the database save time and only orders ties.
4. In development, **Load local August files** reads `data/FollowMe/FollowMe_august_2025/1.csv` through `31.csv` one day at a time. The raw tracks are gitignored. The browser keeps two days in memory.
5. Optionally choose island GeoJSON. Named polygons are used as place names. Medical and Coast Guard sites are points or polygons with `kind` of `medical` or `coast_guard`. A medical site is used only when `verified` is true. If `public/reference/osm-islands.geojson` and `osm-harbours.geojson` exist, they load on their own. See [CONNECTIVITY_METHOD.md](CONNECTIVITY_METHOD.md).
6. In development, Network can read `data/derived/connectivity-august-2025.json` after `npm run data:connectivity`. That summary is gitignored.

**Load synthetic test data** reads `public/fixtures/synthetic-followme.csv` and `public/fixtures/synthetic-islands.geojson`. Those pages are labelled synthetic and are not observations.

The August FollowMe extract lives under `data/FollowMe`. See `QUALITY_AUDIT.md` for the measured schema and `LIMITATIONS.md` for what the files cannot support.

## Sections

The map, the loaded day, and the playback clock stay mounted while you move between sections. Older addresses redirect: `/` and `/explorer` to `/explore`, `/emergency` to `/simulate`, and `/routes` to `/network?tab=routes`.

- **Explore** — day quality, vessel search, and activity cells for the loaded day.
- **Network** — observed connections for the loaded day or, in development, the August summary. Connections, Find opportunities, Frequency, and Route Lab are tabs in this section. Frequency counts observed tracked passages, not a ferry timetable. A place profile opens from a search result, an island, or a connection endpoint. Census 2022 population is labelled by match method: atoll and name, unique name, or official code. Route Lab compares the observed typical time with a typed hypothetical. CSV export omits coordinates and device identifiers.
- **Experimental** — a secondary menu. Emergency Simulation (`/simulate`) places a hypothetical incident against historical positions. It does not dispatch a vessel.

## Team Guide

The header has **Team Guide** and the place search. The guide is a manual walkthrough for the Laari & Logic team. It does not start on its own, and it does not store completion. The steps explain the problem, the August 2025 FollowMe evidence, Explore, playback, search, Network, a connectivity profile, vessel frequency, Find opportunities, Route Lab, the report, and the limits of the data. If a day or the August summary is not loaded, that step stays a short explanation instead of a broken highlight. Details are in [TOUR.md](TOUR.md).

`npm run data:census` reads `data/Census 2022/P5.xlsx` (Maldives Bureau of Statistics Table P5, resident population by island and sex, 2022) and writes `public/reference/census-2022.json`. `npm run data:census-match` prints matched, ambiguous, and unmatched islands against the OpenStreetMap reference. The workbook itself is not modified.

The sidebar can be expanded, collapsed to an icon rail, or hidden. A details card describes the selected vessel, cell, connection, or scenario. Closing the card keeps that selection on the map. Hub hover shows only the unique-vessel count.

## Playback

The bar under the map has play/pause, restart, day controls, a scrubber, the selected window, and a speed from 0.25× to 8×. **1× Normal** moves the historical clock by one sixth of the window every 90 ms, which is the original rate. Faster speeds sample that clock. They do not draw every GPS report between samples, and they do not change a vessel’s reported speed.

A timestamp with no zone is stored as UTC, which is how the original viewer parsed the August extract. A timestamp that already has `Z` or a numeric offset keeps that instant. The clock also shows Maldives time (UTC+5), and either zone can be primary. The reported speed unit is not documented and is not converted. The header search finds islands, atolls, harbour reference points, inferred activity areas, and a masked vessel from the loaded day. It does not list every device identifier.

Space plays and pauses, `P` toggles presentation view, `[` and `]` change speed, and Escape leaves presentation view or closes the details card. Those keys do nothing while a field, button, or link is focused. Presentation view hides the header and sidebar and keeps the playback bar. Its switch follows Explore, Network, and Findings, with Emergency Simulation under Experimental.
