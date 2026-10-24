"""
Island arrivals and departures from FollowMe vessel tracker pings.

What it does
------------
1. Downloads island outlines for the Maldives from OpenStreetMap (Overpass API)
   and caches them in data/islands.geojson. Delete that file to re-download.
2. Matches the islands in data/target_islands.csv to those outlines.
3. Reads data/FollowMe_august_2025/1.csv ... 31.csv one day at a time.
4. For every vessel (same IMEI = same vessel), finds VISITS: the vessel is within
   BUFFER_M of an island's shore, mostly slow, for at least MIN_DWELL_MIN minutes.
   Passing by an island without stopping is not a visit.
5. Each visit gives one ARRIVAL (when it starts) and one DEPARTURE (when it ends),
   counted on the Maldives date (UTC+5) of that moment.

Outputs (data/processed/)
-------------------------
departure_Arrival.csv     one row per island: arrivals, departures, per-day averages, busiest day,
                          unique vessels, typical stay, top 10 origins and destinations with trip counts
island_connections.csv    the same top 10 lists as rows: island, direction, rank, other island, trips
island_summary.csv        the same table (kept for the website)
island_daily_traffic.csv  one row per island per day: arrivals, departures, vessels
visits.csv                every visit: vessel number, island, times, came from, went to
island_match_report.csv   which OpenStreetMap outline each target island was matched to

data/private/vessel_ids.csv maps vessel numbers back to IMEIs. Do not share it.

Run from the project folder:  python jetty/island_visits.py   (or python main.py)
OpenStreetMap data (c) OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import difflib
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import LineString, Polygon, mapping, shape
from shapely.ops import linemerge, polygonize, unary_union

# ---------------------------------------------------------------- settings

ROOT = Path(__file__).resolve().parent.parent
PINGS_DIR = ROOT / "data" / "FollowMe_august_2025"
TARGETS_CSV = ROOT / "data" / "target_islands.csv"
ISLANDS_GEOJSON = ROOT / "data" / "islands.geojson"
OUT_DIR = ROOT / "data" / "processed"
PRIVATE_DIR = ROOT / "data" / "private"
DAYS = range(1, 32)

BUFFER_M = 250          # a ping this close to an island's shore counts as "at" the island
MIN_DWELL_MIN = 10      # shortest stop that counts as a visit
SLOW_KN = 2.0           # below this speed a vessel counts as stopped
SLOW_SHARE = 0.5        # share of pings during the stay that must be slow
NOISE_MERGE_MIN = 15    # a stray excursion shorter than this does not end a visit
MAX_GAP_HOURS = 24      # tracker silence longer than this ends a visit
JUMP_KN = 40            # a ping implying more than this both ways is a GPS spike
MVT_OFFSET_S = 5 * 3600 # Maldives time = UTC + 5
BOX = (-0.8, 7.2, 72.5, 73.9)  # min lat, max lat, min lon, max lon

# metres per degree, close enough across the Maldives (0.7 S to 7.1 N)
KX = 111_320 * np.cos(np.radians(3.2))
KY = 110_574

# rough centre of each atoll, used to tell same-named islands apart
ATOLLS = {
    "HA": ("Haa Alif", 6.95, 72.95), "HDh": ("Haa Dhaalu", 6.60, 73.05),
    "Sh": ("Shaviyani", 6.20, 73.20), "N": ("Noonu", 5.80, 73.40),
    "R": ("Raa", 5.55, 72.95), "B": ("Baa", 5.10, 73.00),
    "Lh": ("Lhaviyani", 5.35, 73.50), "K": ("Kaafu", 4.30, 73.50),
    "AA": ("Alif Alif", 4.15, 72.90), "ADh": ("Alif Dhaal", 3.65, 72.80),
    "V": ("Vaavu", 3.50, 73.45), "M": ("Meemu", 2.95, 73.55),
    "F": ("Faafu", 3.20, 72.95), "Dh": ("Dhaalu", 2.85, 72.95),
    "Th": ("Thaa", 2.35, 73.10), "L": ("Laamu", 1.95, 73.40),
    "GA": ("Gaafu Alif", 0.55, 73.30), "GDh": ("Gaafu Dhaalu", 0.35, 73.05),
    "Gn": ("Gnaviyani", -0.30, 73.43), "S": ("Seenu (Addu)", -0.64, 73.15),
}
MAX_ATOLL_KM = 75  # a match further than this from its atoll centre is rejected

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
ISLAND_QUERY = """
[out:json][timeout:240];
area(3600536773)->.mv;
(
  way["place"~"^(island|islet)$"](area.mv);
  relation["place"~"^(island|islet)$"](area.mv);
);
out geom;
""".strip()


def log(*parts) -> None:
    """Progress messages go to stderr, so stdout stays clean for main.py's JSON."""
    print(*parts, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- OpenStreetMap

def overpass(query: str) -> dict:
    """Runs an Overpass query, trying each mirror up to three times."""
    last_error = "no response"
    for mirror in OVERPASS_MIRRORS:
        for attempt in range(3):
            try:
                request = urllib.request.Request(
                    mirror,
                    data=urllib.parse.urlencode({"data": query}).encode(),
                    headers={"User-Agent": "SeaPulse-datathon/0.2"},
                )
                with urllib.request.urlopen(request, timeout=300) as response:
                    return json.loads(response.read())
            except Exception as error:  # network errors, rate limits, timeouts
                last_error = f"{mirror}: {error}"
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"OpenStreetMap download failed ({last_error})")


def line_of(points) -> list[tuple[float, float]]:
    return [(p["lon"], p["lat"]) for p in points or [] if "lon" in p and "lat" in p]


def element_polygon(element: dict):
    """Island outline from an OSM way or relation. Open fragments are chained, never force-closed."""
    if element["type"] == "way":
        coords = line_of(element.get("geometry"))
        if len(coords) >= 4 and coords[0] == coords[-1]:
            return Polygon(coords)
        return None
    lines = [
        LineString(line_of(member.get("geometry")))
        for member in element.get("members", [])
        if member.get("type") == "way" and member.get("role") in ("outer", "", None)
        and len(line_of(member.get("geometry"))) >= 2
    ]
    if not lines:
        return None
    polygons = list(polygonize(linemerge(lines)))
    return unary_union(polygons) if polygons else None


def download_islands(path: Path) -> None:
    log("Downloading island outlines from OpenStreetMap (one time, takes a minute or two)...")
    data = overpass(ISLAND_QUERY)
    features = []
    for element in data.get("elements", []):
        geometry = element_polygon(element)
        if geometry is None or geometry.is_empty:
            continue
        if not geometry.is_valid:
            geometry = shapely.make_valid(geometry)
        tags = element.get("tags", {})
        features.append({
            "type": "Feature",
            "properties": {
                "name": tags.get("name"),
                "nameEn": tags.get("name:en"),
                "osmId": f"{element['type']}/{element['id']}",
            },
            "geometry": mapping(geometry),
        })
    if not features:
        raise RuntimeError("OpenStreetMap returned no islands; nothing written.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "type": "FeatureCollection",
        "attribution": "(c) OpenStreetMap contributors, ODbL",
        "features": features,
    }), encoding="utf-8")
    log(f"  saved {len(features)} islands to {path.relative_to(ROOT)}")


# ---------------------------------------------------------------- names and matching

def latin(value) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    if re.search(r"[ހ-޿]", value) or not re.search(r"[A-Za-z]", value):
        return None
    return value


def norm(name: str) -> str:
    """'Male\\'' and 'Malé' both become 'male'; 'Maradhoo-Feydhoo' becomes 'maradhoofeydhoo'."""
    text = unicodedata.normalize("NFKD", name)
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"\b(island|islet|city)\b", "", text)
    return re.sub(r"[^a-z]", "", text)


def project(geometry):
    return shapely.transform(geometry, lambda xy: xy * np.array([KX, KY]))


def load_islands() -> pd.DataFrame:
    if not ISLANDS_GEOJSON.exists():
        download_islands(ISLANDS_GEOJSON)
    collection = json.loads(ISLANDS_GEOJSON.read_text(encoding="utf-8"))
    rows = []
    for feature in collection["features"]:
        props = feature.get("properties") or {}
        geometry = shape(feature["geometry"])
        if geometry.is_empty:
            continue
        if not geometry.is_valid:
            geometry = shapely.make_valid(geometry)
        name = (latin(props.get("nameEn")) or latin(props.get("name:en"))
                or latin(props.get("name_en")) or latin(props.get("name")))
        point = geometry.representative_point()
        rows.append({
            "osm_id": str(props.get("osmId") or props.get("osm_id") or feature.get("id") or len(rows)),
            "osm_name": name,
            "key": norm(name) if name else "",
            "lon": point.x,
            "lat": point.y,
            "geometry_m": project(geometry),
        })
    log(f"Loaded {len(rows)} island outlines from OpenStreetMap")
    return pd.DataFrame(rows)


def km_between(lat1, lon1, lat2, lon2):
    return np.hypot((lon1 - lon2) * KX, (lat1 - lat2) * KY) / 1000


def match_targets(islands: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray, list[str]]:
    """Gives every OSM outline a group number. Target islands get labels like 'Maafushi (K)'."""
    targets = pd.read_csv(TARGETS_CSV, dtype=str).fillna("")
    group_of = np.full(len(islands), -1, dtype=np.int64)
    labels: list[str] = []
    report = []
    all_keys = islands["key"].tolist()

    for target in targets.itertuples(index=False):
        label = f"{target.island} ({target.atoll})" if target.atoll else target.island
        group = len(labels)
        labels.append(label)
        aliases = [a.strip() for a in (target.aliases or target.island).split(";") if a.strip()]
        centre = ATOLLS.get(target.atoll)
        found, how = [], "not found"
        for alias in aliases:
            key = norm(alias)
            candidates = islands.index[islands["key"] == key]
            method = "exact"
            if len(candidates) == 0:
                close = set(difflib.get_close_matches(key, all_keys, n=10, cutoff=0.88))
                candidates = islands.index[islands["key"].isin(close)]
                method = "similar spelling"
            candidates = [i for i in candidates if group_of[i] == -1 and i not in found]
            if not candidates:
                continue
            pick = islands.loc[candidates]
            if centre:
                distance = km_between(pick["lat"], pick["lon"], centre[1], centre[2])
                pick = pick.assign(distance=distance)
                pick = pick[pick["distance"] <= MAX_ATOLL_KM].sort_values("distance")
            if pick.empty:
                continue
            best = pick.iloc[0]
            # same-named outlines within 3 km are parts of the same island
            nearby = pick[km_between(pick["lat"], pick["lon"], best["lat"], best["lon"]) <= 3]
            found.extend(nearby.index.tolist())
            how = method
        for index in found:
            group_of[index] = group
        report.append({
            "island": target.island,
            "atoll": target.atoll,
            "label": label,
            "status": "matched" if found else "NOT FOUND - add a spelling in aliases",
            "method": how if found else "",
            "osm_names": "; ".join(sorted({str(islands.at[i, "osm_name"]) for i in found})),
            "osm_ids": "; ".join(islands.loc[found, "osm_id"]),
        })

    # every other outline (resorts, uninhabited islands) still counts as a place to stop
    for index in np.flatnonzero(group_of == -1):
        group_of[index] = len(labels)
        name = islands.at[index, "osm_name"]
        labels.append(f"other: {name}" if name else f"other: unnamed ({islands.at[index, 'osm_id']})")
    return pd.DataFrame(report), group_of, labels


# ---------------------------------------------------------------- pings

def read_pings(path: Path) -> pd.DataFrame:
    header = pd.read_csv(path, nrows=0).columns.str.strip().tolist()
    if "device_date" in header:
        frame = pd.read_csv(path, usecols=["imei", "device_date", "latitude", "longitude"],
                            dtype={"imei": str, "device_date": str})
    else:  # older files without a header: imei, time, lat, lon in columns 1, 3, 4, 5
        frame = pd.read_csv(path, header=None, usecols=[1, 3, 4, 5], dtype={1: str, 3: str})
        frame.columns = ["imei", "device_date", "latitude", "longitude"]
    frame["imei"] = frame["imei"].str.strip()
    frame["latitude"] = pd.to_numeric(frame["latitude"], errors="coerce")
    frame["longitude"] = pd.to_numeric(frame["longitude"], errors="coerce")
    stamp = pd.to_datetime(frame["device_date"], format="%Y-%m-%d %H:%M:%S", errors="coerce", utc=True)
    frame["t"] = (stamp - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta(seconds=1)
    lat_min, lat_max, lon_min, lon_max = BOX
    keep = (frame["imei"].notna() & frame["t"].notna()
            & frame["latitude"].between(lat_min, lat_max, inclusive="neither")
            & frame["longitude"].between(lon_min, lon_max, inclusive="neither"))
    frame = frame.loc[keep, ["imei", "t", "latitude", "longitude"]]
    frame["t"] = frame["t"].astype("int64")
    return frame.drop_duplicates(["imei", "t", "latitude", "longitude"])


def speeds_knots(v, t, x, y) -> np.ndarray:
    """Speed into each ping from the previous ping of the same vessel. NaN for a vessel's first ping."""
    speed = np.full(len(v), np.nan)
    if len(v) < 2:
        return speed
    same = v[1:] == v[:-1]
    dt = (t[1:] - t[:-1]).astype(float)
    dist = np.hypot(x[1:] - x[:-1], y[1:] - y[:-1])
    with np.errstate(divide="ignore", invalid="ignore"):
        kn = np.where(dt > 0, dist / 1852 / (dt / 3600), np.where(dist < 5, 0.0, np.inf))
    speed[1:] = np.where(same, kn, np.nan)
    return speed


def day_runs(frame: pd.DataFrame, carry: pd.DataFrame, vessel_ids: dict, tree, group_of):
    """Turns one day of pings into runs: consecutive pings of one vessel at the same place."""
    new = [imei for imei in frame["imei"].unique() if imei not in vessel_ids]
    for imei in new:
        vessel_ids[imei] = len(vessel_ids)
    today = pd.DataFrame({
        "v": frame["imei"].map(vessel_ids).to_numpy(np.int64),
        "t": frame["t"].to_numpy(np.int64),
        "x": frame["longitude"].to_numpy() * KX,
        "y": frame["latitude"].to_numpy() * KY,
        "carry": False,
    })
    both = pd.concat([carry.assign(carry=True), today], ignore_index=True)
    both = both.sort_values(["v", "t", "carry"], ascending=[True, True, False], kind="stable")

    # drop GPS spikes: a ping that is impossibly far from both neighbours
    v, t, x, y = (both[c].to_numpy() for c in ("v", "t", "x", "y"))
    speed_in = speeds_knots(v, t, x, y)
    speed_out = np.append(speed_in[1:], np.nan)
    spike = (speed_in > JUMP_KN) & (speed_out > JUMP_KN) & ~both["carry"].to_numpy()
    both = both.loc[~spike]
    v, t, x, y = (both[c].to_numpy() for c in ("v", "t", "x", "y"))
    speed = speeds_knots(v, t, x, y)

    # nearest island within BUFFER_M (inside an island counts as distance 0)
    group = np.full(len(both), -1, dtype=np.int64)
    found = tree.query_nearest(shapely.points(x, y), max_distance=BUFFER_M, all_matches=False)
    group[found[0]] = group_of[found[1]]

    is_today = ~both["carry"].to_numpy()
    next_carry = pd.concat([carry, both.loc[is_today, ["v", "t", "x", "y"]]]).groupby("v").tail(1)
    next_carry = next_carry.sort_values("t").groupby("v").tail(1).reset_index(drop=True)

    v, t, g = v[is_today], t[is_today], group[is_today]
    slow = np.nan_to_num(speed[is_today], nan=0.0) < SLOW_KN
    if len(v) == 0:
        return pd.DataFrame(columns=["v", "g", "t0", "t1", "n", "n_slow"]), next_carry
    brk = np.ones(len(v), dtype=bool)
    brk[1:] = (v[1:] != v[:-1]) | (g[1:] != g[:-1]) | (t[1:] - t[:-1] > MAX_GAP_HOURS * 3600)
    run_id = np.cumsum(brk) - 1
    runs = pd.DataFrame({"run": run_id, "v": v, "g": g, "t": t, "slow": slow}).groupby("run").agg(
        v=("v", "first"), g=("g", "first"), t0=("t", "min"), t1=("t", "max"),
        n=("t", "size"), n_slow=("slow", "sum"))
    return runs.reset_index(drop=True), next_carry


def stitch(runs: pd.DataFrame) -> pd.DataFrame:
    """Joins runs split at midnight, then absorbs short stray excursions inside a stay."""
    runs = runs.sort_values(["v", "t0"], kind="stable").reset_index(drop=True)
    v, g, t0, t1 = (runs[c].to_numpy() for c in ("v", "g", "t0", "t1"))
    brk = np.ones(len(runs), dtype=bool)
    brk[1:] = (v[1:] != v[:-1]) | (g[1:] != g[:-1]) | (t0[1:] - t1[:-1] > MAX_GAP_HOURS * 3600)
    runs = runs.groupby(np.cumsum(brk)).agg(
        v=("v", "first"), g=("g", "first"), t0=("t0", "min"), t1=("t1", "max"),
        n=("n", "sum"), n_slow=("n_slow", "sum")).reset_index(drop=True)

    noise_s = NOISE_MERGE_MIN * 60
    out_v, out_g, out_t0, out_t1, out_n, out_s = [], [], [], [], [], []
    for rv, rg, a, b, n, s in runs[["v", "g", "t0", "t1", "n", "n_slow"]].itertuples(index=False, name=None):
        if rg != -1:
            k = len(out_g) - 1
            match = -1
            while k >= 0 and out_v[k] == rv and out_t1[k] >= a - noise_s:
                if out_g[k] == rg:
                    match = k
                    break
                k -= 1
            if match >= 0:
                a = out_t0[match]
                n += sum(out_n[match:])
                s += sum(out_s[match:])
                for column in (out_v, out_g, out_t0, out_t1, out_n, out_s):
                    del column[match:]
        out_v.append(rv); out_g.append(rg); out_t0.append(a); out_t1.append(b)
        out_n.append(n); out_s.append(s)
    return pd.DataFrame({"v": out_v, "g": out_g, "t0": out_t0, "t1": out_t1, "n": out_n, "n_slow": out_s})


# ---------------------------------------------------------------- visits and counts

def mvt_dates(seconds) -> pd.Series:
    return pd.to_datetime((np.asarray(seconds) + MVT_OFFSET_S) // 86400 * 86400, unit="s").date


def mvt_times(seconds) -> pd.Series:
    return pd.to_datetime(np.asarray(seconds) + MVT_OFFSET_S, unit="s")


def build_visits(runs: pd.DataFrame, first_seen: pd.Series, last_seen: pd.Series, labels) -> pd.DataFrame:
    stays = runs[runs["g"] != -1]
    is_visit = ((stays["t1"] - stays["t0"] >= MIN_DWELL_MIN * 60)
                & (stays["n_slow"] / stays["n"] >= SLOW_SHARE))
    visits = stays[is_visit].sort_values(["v", "t0"]).reset_index(drop=True)
    names = np.array(labels, dtype=object)
    visits["place"] = names[visits["g"].to_numpy()]
    same_vessel_before = visits["v"].eq(visits["v"].shift())
    same_vessel_after = visits["v"].eq(visits["v"].shift(-1))
    visits["came_from"] = visits["place"].shift().where(same_vessel_before, "unknown (start of data)")
    visits["went_to"] = visits["place"].shift(-1).where(same_vessel_after, "unknown (end of data)")
    # a vessel already sitting at an island when the data starts did not arrive; same for the end
    visits["arrival_counted"] = visits["t0"] > visits["v"].map(first_seen)
    visits["departure_counted"] = visits["t1"] < visits["v"].map(last_seen)
    visits["arrive_mvt"] = mvt_times(visits["t0"])
    visits["depart_mvt"] = mvt_times(visits["t1"])
    visits["arrive_date"] = mvt_dates(visits["t0"])
    visits["depart_date"] = mvt_dates(visits["t1"])
    visits["dwell_min"] = ((visits["t1"] - visits["t0"]) / 60).round(1)
    return visits


def daily_traffic(visits: pd.DataFrame, report: pd.DataFrame, dates) -> pd.DataFrame:
    targets = report["label"].tolist()
    ours = visits[visits["place"].isin(targets)]
    arrived = ours[ours["arrival_counted"]].groupby(["place", "arrive_date"]).agg(
        arrivals=("v", "size"), vessels_arrived=("v", "nunique"))
    departed = ours[ours["departure_counted"]].groupby(["place", "depart_date"]).agg(
        departures=("v", "size"), vessels_departed=("v", "nunique"))
    arrived.index.names = departed.index.names = ["place", "date"]

    # vessels present: any visit overlapping that date, including stays across midnight
    spans = ours[["place", "v", "arrive_date", "depart_date"]].copy()
    spans["date"] = [list(pd.date_range(a, b).date) for a, b in zip(spans["arrive_date"], spans["depart_date"])]
    present = spans.explode("date").groupby(["place", "date"])["v"].nunique().rename("vessels_present")

    grid = pd.MultiIndex.from_product([targets, dates], names=["place", "date"])
    table = pd.concat([arrived, departed, present], axis=1).reindex(grid).fillna(0).astype(int)
    table["net_flow"] = table["arrivals"] - table["departures"]
    table = table.reset_index().merge(
        report[["label", "island", "atoll"]], left_on="place", right_on="label").drop(columns=["label", "place"])
    columns = ["date", "island", "atoll", "arrivals", "departures", "net_flow",
               "vessels_arrived", "vessels_departed", "vessels_present"]
    return table[columns].sort_values(["island", "atoll", "date"])


def island_summary(visits: pd.DataFrame, daily: pd.DataFrame, report: pd.DataFrame, n_days: int) -> pd.DataFrame:
    rows = []
    for target in report.itertuples(index=False):
        ours = visits[visits["place"] == target.label]
        mine = daily[(daily["island"] == target.island) & (daily["atoll"] == target.atoll)]
        arrivals = ours[ours["arrival_counted"]]
        complete = ours[ours["arrival_counted"] & ours["departure_counted"]]
        origins = arrivals.loc[~arrivals["came_from"].str.startswith("unknown"), "came_from"]
        destinations = ours.loc[ours["departure_counted"] & ~ours["went_to"].str.startswith("unknown"), "went_to"]
        rows.append({
            "island": target.island,
            "atoll": target.atoll,
            "atoll_name": ATOLLS.get(target.atoll, ("",))[0],
            "on_map": target.status == "matched",
            "total_arrivals": int(mine["arrivals"].sum()),
            "total_departures": int(mine["departures"].sum()),
            "avg_arrivals_per_day": round(mine["arrivals"].sum() / n_days, 2),
            "avg_departures_per_day": round(mine["departures"].sum() / n_days, 2),
            "avg_vessels_present_per_day": round(mine["vessels_present"].mean(), 2) if len(mine) else 0,
            "busiest_day": mine.loc[mine["arrivals"].idxmax(), "date"] if mine["arrivals"].sum() else "",
            "busiest_day_arrivals": int(mine["arrivals"].max()) if len(mine) else 0,
            "unique_vessels_month": int(ours["v"].nunique()),
            "median_stay_min": round(complete["dwell_min"].median(), 1) if len(complete) else None,
            "top_came_from": origins.mode().iat[0] if len(origins) else "",
            "top_went_to": destinations.mode().iat[0] if len(destinations) else "",
        })
    return pd.DataFrame(rows).sort_values("total_arrivals", ascending=False)


TOP_LINKS = 10              # how many origins and destinations to list per island
SAME_ISLAND = "same island (left and came back)"


def connections(visits: pd.DataFrame, summary: pd.DataFrame, top: int = TOP_LINKS) -> pd.DataFrame:
    """For each island: where its arriving boats came from and where its departing boats went,
    ranked by number of trips. Reads the columns of visits.csv."""
    labels = set(summary["island"] + " (" + summary["atoll"] + ")")
    counted = lambda column: visits[column].astype(str).str.lower().eq("true")
    parts = []
    for direction, flag, other in [("arrived_from", "arrival_counted", "came_from"),
                                   ("departed_to", "departure_counted", "went_to")]:
        rows = visits[visits["island"].isin(labels) & counted(flag)
                      & ~visits[other].astype(str).str.startswith("unknown")]
        links = rows.groupby(["island", other]).size().rename("trips").reset_index()
        links = links.rename(columns={other: "other_island"})
        links["share_pct"] = (links["trips"] / links.groupby("island")["trips"].transform("sum") * 100).round(1)
        links = links.sort_values(["island", "trips"], ascending=[True, False])
        links["rank"] = links.groupby("island").cumcount() + 1
        links["direction"] = direction
        parts.append(links[links["rank"] <= top])
    if not parts:
        return pd.DataFrame(columns=["island", "direction", "rank", "other_island", "trips", "share_pct"])
    out = pd.concat(parts, ignore_index=True)
    out["other_island"] = out["other_island"].where(out["other_island"] != out["island"], SAME_ISLAND)
    return out[["island", "direction", "rank", "other_island", "trips", "share_pct"]]


def with_connection_lists(summary: pd.DataFrame, links: pd.DataFrame) -> pd.DataFrame:
    """Adds two readable columns, e.g. "Male' city (K) 523; Hulhule (K) 120; ..."."""
    summary = summary.drop(columns=["arrivals_from_top10", "departures_to_top10"], errors="ignore")
    label = summary["island"] + " (" + summary["atoll"] + ")"
    for direction, column in [("arrived_from", "arrivals_from_top10"), ("departed_to", "departures_to_top10")]:
        part = links[links["direction"] == direction]
        text = {island: "; ".join(f"{o} {t}" for o, t in zip(group["other_island"], group["trips"]))
                for island, group in part.groupby("island")}
        summary[column] = label.map(text).fillna("")
    return summary


# ---------------------------------------------------------------- main

def main() -> None:
    if not TARGETS_CSV.exists():
        sys.exit(f"Missing {TARGETS_CSV.relative_to(ROOT)}")
    if not PINGS_DIR.exists():
        sys.exit(f"Missing ping folder {PINGS_DIR.relative_to(ROOT)}")

    islands = load_islands()
    report, group_of, labels = match_targets(islands)
    missing = report[report["status"] != "matched"]
    log(f"Matched {len(report) - len(missing)} of {len(report)} target islands to OpenStreetMap")
    if len(missing):
        shown = ", ".join(missing["label"].head(25))
        more = f" and {len(missing) - 25} more" if len(missing) > 25 else ""
        log(f"  not found: {shown}{more} (see island_match_report.csv)")
    tree = shapely.STRtree(islands["geometry_m"].to_numpy())

    vessel_ids: dict[str, int] = {}
    carry = pd.DataFrame({"v": pd.Series(dtype="int64"), "t": pd.Series(dtype="int64"),
                          "x": pd.Series(dtype="float64"), "y": pd.Series(dtype="float64")})
    all_runs, first_seen, last_seen, skipped = [], {}, {}, []
    for day in DAYS:
        path = PINGS_DIR / f"{day}.csv"
        if not path.exists():
            skipped.append(str(day))
            continue
        started = time.time()
        frame = read_pings(path)
        runs, carry = day_runs(frame, carry, vessel_ids, tree, group_of)
        all_runs.append(runs)
        for row in runs.groupby("v").agg(t0=("t0", "min"), t1=("t1", "max")).itertuples():
            first_seen[row.Index] = min(first_seen.get(row.Index, row.t0), row.t0)
            last_seen[row.Index] = max(last_seen.get(row.Index, row.t1), row.t1)
        log(f"  {day}.csv  pings={len(frame):,}  vessels={frame['imei'].nunique():,}  {time.time() - started:.1f}s")
    if skipped:
        log(f"  missing day files (skipped): {', '.join(skipped)}")
    if not all_runs:
        sys.exit("No ping files were read.")

    runs = stitch(pd.concat(all_runs, ignore_index=True))
    visits = build_visits(runs, pd.Series(first_seen), pd.Series(last_seen), labels)
    first_date = mvt_dates([min(first_seen.values())])[0]
    last_date = mvt_dates([max(last_seen.values())])[0]
    dates = list(pd.date_range(first_date, last_date).date)
    daily = daily_traffic(visits, report, dates)
    summary = island_summary(visits, daily, report, len(dates))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    width = len(str(len(vessel_ids)))
    vessel_name = {number: f"V{number + 1:0{width}d}" for number in vessel_ids.values()}
    visit_file = visits.assign(vessel=visits["v"].map(vessel_name))[
        ["vessel", "place", "arrive_mvt", "depart_mvt", "dwell_min", "came_from", "went_to",
         "arrival_counted", "departure_counted"]].rename(columns={"place": "island"})

    links = connections(visit_file, summary)
    summary = with_connection_lists(summary, links)
    links.to_csv(OUT_DIR / "island_connections.csv", index=False)
    summary.to_csv(OUT_DIR / "island_summary.csv", index=False)
    summary.to_csv(OUT_DIR / "departure_Arrival.csv", index=False)
    daily.to_csv(OUT_DIR / "island_daily_traffic.csv", index=False)
    visit_file.to_csv(OUT_DIR / "visits.csv", index=False)
    report.to_csv(OUT_DIR / "island_match_report.csv", index=False)
    pd.DataFrame({"vessel": [vessel_name[n] for n in vessel_ids.values()], "imei": list(vessel_ids)}).to_csv(
        PRIVATE_DIR / "vessel_ids.csv", index=False)

    on_targets = visits["place"].isin(report["label"])
    log(f"\nVessels: {len(vessel_ids):,}   visits: {len(visits):,} "
          f"({on_targets.sum():,} at target islands)   days: {len(dates)} ({first_date} to {last_date})")
    log("\nBusiest islands (arrivals over the whole period):")
    log(summary[["island", "atoll", "total_arrivals", "total_departures", "avg_arrivals_per_day"]]
          .head(10).to_string(index=False))
    log(f"\nWrote results to {OUT_DIR.relative_to(ROOT)}")


if __name__ == "__main__":
    main()  # steps 1 and 2: arrivals and departures, saved to departure_Arrival.csv
    import jetty_need  # step 3: runs automatically on the file just saved
    log("\nStep 3: checking which islands need a bigger jetty")
    jetty_need.main()