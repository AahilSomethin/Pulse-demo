"""
Does vessel traffic per island make sense, and do residents justify expanding the jetty?

Reads
-----
data/Island_metrics.csv                 population, airport, capital, hospital level per island
data/processed/departure_Arrival.csv    arrivals, departures, vessels per island (from island_visits.py)
data/processed/visits.csv               every visit (optional; used for each island's home fleet)

Asks
----
1. Do bigger islands get more boats?           population vs arrivals (rank correlation, log-log fit)
2. What else explains traffic?                 airport, atoll capital, hospital level, home fishing/work fleet,
                                               being in Kaafu (next to Malé)
3. Per island: how much traffic would its population alone predict, and how busy is it?
4. Verdict: is a jetty expansion justified by the island's own residents and boats?

Writes
------
data/processed/jetty_need.csv         one row per island with the measures and a verdict
data/processed/jetty_need_model.json  the model, its numbers and plain-English findings

Run from the project folder:  python jetty/jetty_need.py
Associations, not proof of cause. No jetty capacity data is used, so "pressure" is relative between islands.
"""

from __future__ import annotations

import io
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
METRICS_CSV = ROOT / "data" / "Island_metrics.csv"
TRAFFIC_CSV = ROOT / "data" / "processed" / "departure_Arrival.csv"
VISITS_CSV = ROOT / "data" / "processed" / "visits.csv"
OUT_CSV = ROOT / "data" / "processed" / "jetty_need.csv"
OUT_JSON = ROOT / "data" / "processed" / "jetty_need_model.json"

NATIONAL_HUBS = {"Male' city", "Hulhule"}      # analysed separately: they serve the whole country
OVERNIGHT_HOUR = 3                               # a vessel at an island at 03:00 spent the night there
MIN_HOME_NIGHTS = 3                              # nights needed before an island counts as a vessel's home
def hospital_rank(level: str) -> float:
    """Health facility level as a number: 0 unknown, 1-4 health centre grades,
    5-7 hospital grades 1-3, 8 tertiary. Also accepts the older 'atoll'/'regional' labels."""
    text = str(level).lower()
    grade = re.search(r"grade\s*(\d)", text)
    if "tertiary" in text:
        return 8
    if "regional" in text:
        return 7
    if "atoll" in text:
        return 6
    if "hospital" in text:
        return 4 + int(grade.group(1)) if grade else 5
    if grade:
        return int(grade.group(1))
    return 0


def log(*parts) -> None:
    print(*parts, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- loading

def _column(frame: pd.DataFrame, *words: str) -> str | None:
    """First column whose lower-case name contains every word."""
    for name in frame.columns:
        low = name.lower()
        if all(word in low for word in words):
            return name
    return None


def _key(atoll: str, island: str) -> str:
    atoll = {"adh": "ADh", "hdh": "HDh", "gdh": "GDh"}.get(str(atoll).strip().lower(), str(atoll).strip())
    return f"{atoll.lower()}|{re.sub(r'[^a-z]', '', str(island).lower())}"


def load_metrics() -> pd.DataFrame:
    raw = METRICS_CSV.read_bytes()
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):  # Excel on Windows saves cp1252
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    header = text.splitlines()[0]
    sep = "\t" if "\t" in header else ","
    width = len(header.split(sep))
    frame = pd.read_csv(io.StringIO(text), sep=sep, engine="python", dtype=str, keep_default_na=False,
                        on_bad_lines=lambda extra: extra[:width])  # rows with stray trailing commas
    frame.columns = [str(c).replace("\xa0", " ").strip() for c in frame.columns]
    frame = frame.apply(lambda c: c.astype(str).str.replace("\xa0", " ").str.strip())
    atoll, island = _column(frame, "atoll"), _column(frame, "island")
    pop22, pop14 = _column(frame, "2022"), _column(frame, "2014")
    airport, capital, hospital = _column(frame, "airport"), _column(frame, "capital"), _column(frame, "hospital", "level")
    frame = frame[(frame[island] != "") & (frame[atoll] != "") & ~frame[island].str.startswith("http")]

    number = lambda s: pd.to_numeric(s.str.replace(r"[,\s]", "", regex=True), errors="coerce")
    out = pd.DataFrame({
        "key": [_key(a, i) for a, i in zip(frame[atoll], frame[island])],
        "population_2022": number(frame[pop22]) if pop22 else np.nan,
        "population_2014": number(frame[pop14]) if pop14 else np.nan,
        "airport": frame[airport].str.len() > 0 if airport else False,
        "capital": frame[capital].str.upper().eq("TRUE") if capital else False,
        "hospital_level": frame[hospital].str.lower().replace("", "health centre") if hospital else "health centre",
    })
    out["population"] = out["population_2022"].fillna(out["population_2014"])

    both = out.dropna(subset=["population_2022", "population_2014"])
    swing = both["population_2022"] / both["population_2014"]
    odd = ((swing > 2.5) | (swing < 0.5)).sum()
    if len(both) and odd > len(both) * 0.15:
        log(f"WARNING: {odd} islands change population more than 2.5x between 2014 and 2022. "
            "Check the 2022 column in Island_metrics.csv; it may not be Census 2022 Table P5.")
    return out.drop_duplicates("key")


def load_traffic() -> pd.DataFrame:
    path = TRAFFIC_CSV if TRAFFIC_CSV.exists() else ROOT / "data" / "processed" / "island_summary.csv"
    if not path.exists():
        sys.exit("No traffic results. Run python main.py (or python jetty/island_visits.py) first.")
    frame = pd.read_csv(path)
    frame["key"] = [_key(a, i) for a, i in zip(frame["atoll"], frame["island"])]
    frame["label"] = frame["island"] + " (" + frame["atoll"] + ")"
    return frame


def home_fleets(labels: set[str]) -> pd.DataFrame | None:
    """Vessels based at each island: the island where a vessel spends most nights.
    A vessel that keeps leaving and coming back without stopping elsewhere is
    typical of fishing and local work boats, so round trips are counted too."""
    if not VISITS_CSV.exists():
        log("visits.csv not found: home fleet sizes skipped")
        return None
    visits = pd.read_csv(VISITS_CSV, usecols=["vessel", "island", "arrive_mvt", "depart_mvt", "came_from"],
                         parse_dates=["arrive_mvt", "depart_mvt"])
    shift = pd.Timedelta(hours=OVERNIGHT_HOUR)
    first_night = ((visits["arrive_mvt"] - shift).dt.ceil("D"))
    last_night = ((visits["depart_mvt"] - shift).dt.floor("D"))
    visits["nights"] = ((last_night - first_night).dt.days + 1).clip(lower=0)

    nights = visits.groupby(["vessel", "island"])["nights"].sum().reset_index()
    nights = nights[nights["nights"] >= MIN_HOME_NIGHTS].sort_values("nights", ascending=False)
    home = nights.drop_duplicates("vessel")
    fleet = home.groupby("island")["vessel"].nunique().rename("home_fleet")

    round_trip = visits["came_from"] == visits["island"]
    trips = visits[round_trip].groupby("island").size().rename("round_trips")
    total = visits.groupby("island").size().rename("visits")
    table = pd.concat([fleet, trips, total], axis=1).fillna(0)
    table["round_trip_share"] = (table["round_trips"] / table["visits"]).round(3)
    table = table[table.index.isin(labels)].reset_index().rename(columns={"index": "label", "island": "label"})
    return table[["label", "home_fleet", "round_trips", "round_trip_share"]]


# ---------------------------------------------------------------- statistics

def spearman(x: pd.Series, y: pd.Series) -> float:
    return float(x.rank().corr(y.rank()))


def ols(y: np.ndarray, columns: dict[str, np.ndarray]) -> dict:
    """Least squares with an intercept; returns coefficients, standard errors, p-values, R²."""
    names = ["intercept", *columns]
    X = np.column_stack([np.ones(len(y)), *columns.values()])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    fitted = X @ beta
    resid = y - fitted
    n, k = X.shape
    sigma2 = resid @ resid / max(n - k, 1)
    cov = sigma2 * np.linalg.pinv(X.T @ X)
    se = np.sqrt(np.diag(cov))
    t = beta / np.where(se > 0, se, np.nan)
    p = [math.erfc(abs(v) / math.sqrt(2)) if np.isfinite(v) else None for v in t]  # normal approximation
    r2 = 1 - (resid @ resid) / ((y - y.mean()) @ (y - y.mean()))
    return {
        "n": int(n), "r2": round(float(r2), 3),
        "adj_r2": round(float(1 - (1 - r2) * (n - 1) / max(n - k, 1)), 3),
        "coefficients": {name: {"estimate": round(float(b), 4), "std_error": round(float(s), 4),
                                "p_value": None if pv is None else round(pv, 4)}
                         for name, b, s, pv in zip(names, beta, se, p)},
        "fitted": fitted,
    }


def percentile(series: pd.Series) -> pd.Series:
    return series.rank(pct=True) * 100


# ---------------------------------------------------------------- verdicts

def verdict(row) -> tuple[str, str]:
    if row["role"] == "national hub":
        return "National hub", "Serves the whole country; judge against national transport plans, not residents."
    if row["role"] == "airport island":
        return "Airport transfer point", "No resident population; traffic is airport transfers."
    if not row["on_map"] or row["total_arrivals"] == 0:
        return "No data", "Island not matched on the map or no visits detected; fix the match first."
    pressure, ratio, ratio_full = row["pressure_score"], row["traffic_vs_population"], row["traffic_vs_full_model"]
    if pressure >= 75:
        if ratio <= 1.5:
            return ("Strong case",
                    "Very busy and in line with what its residents generate. Expansion is justified by "
                    "the island's own population.")
        if ratio_full <= 1.5:
            return ("Strong case, local fleet",
                    "Very busy, more than its population alone explains, but in line with the number of "
                    "boats based on the island (fishing, ferry, guesthouse and work vessels) and its "
                    "services. The demand comes from residents' own livelihoods, so citizens justify expansion.")
        return ("Strong case, wider role",
                "Very busy, well beyond what its population and services explain: likely tourism "
                "(guesthouses, excursions), transit or industry. Justify expansion on that economic role, "
                "not residents alone.")
    if pressure >= 50:
        if ratio > 1.5 and ratio_full > 1.5:
            return "Moderate, growing role", "Busier than its population and services predict; watch for congestion."
        if ratio < 0.67:
            return "Moderate", "Fairly busy but below what its population predicts."
        return "Moderate", "Traffic matches its population; expansion is a medium priority."
    if ratio < 0.5:
        return ("Check access",
                "Much less traffic than its population predicts. Either residents travel little by "
                "sea, or the jetty limits access. Worth a site check before deciding.")
    return "Weak case", "Low traffic for its size; expansion is not a priority on current numbers."


# ---------------------------------------------------------------- main

def main() -> dict:
    metrics = load_metrics()
    traffic = load_traffic()
    data = traffic.merge(metrics, on="key", how="left")
    fleet = home_fleets(set(data["label"]))
    if fleet is not None:
        data = data.merge(fleet, on="label", how="left")
        data[["home_fleet", "round_trips"]] = data[["home_fleet", "round_trips"]].fillna(0)

    data["airport"] = data["airport"].eq(True)
    data["capital"] = data["capital"].eq(True)
    data["role"] = np.where(data["island"].isin(NATIONAL_HUBS), "national hub",
                   np.where(data["population"].isna() & data["airport"], "airport island", "island"))
    data["hospital_level"] = data["hospital_level"].fillna("health centre")
    data["hospital_rank"] = data["hospital_level"].map(hospital_rank)
    data["kaafu"] = data["atoll"].eq("K")
    data["arrivals_per_1000_residents"] = (data["total_arrivals"] / data["population"] * 1000).round(1)

    sample = data[(data["role"] == "island") & data["on_map"] & (data["total_arrivals"] > 0)
                  & data["population"].gt(0)].copy()
    log(f"Islands in the model: {len(sample)} (excluding national hubs, airport islands and unmatched islands)")

    y = np.log(sample["total_arrivals"].to_numpy(float))
    log_pop = np.log(sample["population"].to_numpy(float))

    # 1. population alone
    rho = spearman(sample["population"], sample["total_arrivals"])
    rho_vessels = spearman(sample["population"], sample["unique_vessels_month"])
    pop_only = ols(y, {"log_population": log_pop})
    elasticity = pop_only["coefficients"]["log_population"]["estimate"]

    # 2. population plus what the island offers
    extra = {
        "airport": sample["airport"].to_numpy(float),
        "atoll_capital": sample["capital"].to_numpy(float),
        "hospital_level": sample["hospital_rank"].to_numpy(float),
        "in_kaafu": sample["kaafu"].to_numpy(float),
    }
    services = ols(y, {"log_population": log_pop, **extra})
    models = {"population_only": pop_only, "population_and_services": services}
    full = services
    if fleet is not None:
        full = ols(y, {"log_population": log_pop, **extra,
                       "log_home_fleet": np.log1p(sample["home_fleet"].to_numpy(float))})
        models["population_services_and_fleet"] = full

    # 3. per island: what population alone predicts, and how busy it is
    sample["expected_from_population"] = np.exp(pop_only["fitted"]).round(0)
    sample["expected_from_full_model"] = np.exp(full["fitted"]).round(0)
    data = data.merge(sample[["label", "expected_from_population", "expected_from_full_model"]],
                      on="label", how="left")
    data["traffic_vs_population"] = (data["total_arrivals"] / data["expected_from_population"]).round(2)
    data["traffic_vs_full_model"] = (data["total_arrivals"] / data["expected_from_full_model"]).round(2)
    data["share_explained_by_population_pct"] = (
        (data["expected_from_population"] / data["total_arrivals"]).clip(upper=1) * 100).round(0)

    parts = [percentile(data["avg_arrivals_per_day"]), percentile(data["avg_vessels_present_per_day"])]
    if fleet is not None:
        parts.append(percentile(data["home_fleet"]))
    data["pressure_score"] = pd.concat(parts, axis=1).mean(axis=1).round(0)
    data[["jetty_case", "reason"]] = data.apply(lambda r: pd.Series(verdict(r)), axis=1)

    columns = ["island", "atoll", "role", "population", "airport", "capital", "hospital_level",
               "total_arrivals", "total_departures", "avg_arrivals_per_day", "avg_vessels_present_per_day",
               "unique_vessels_month", "arrivals_per_1000_residents",
               *(["home_fleet", "round_trips", "round_trip_share"] if fleet is not None else []),
               "expected_from_population", "expected_from_full_model", "traffic_vs_population",
               "traffic_vs_full_model", "share_explained_by_population_pct", "pressure_score", "jetty_case", "reason"]
    result = data[columns].sort_values(["pressure_score", "total_arrivals"], ascending=False)
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(OUT_CSV, index=False)

    # 4. findings in plain English
    coef = full["coefficients"]
    effect = lambda name: math.exp(coef[name]["estimate"]) - 1 if name in coef else None
    significant = lambda name: name in coef and coef[name]["p_value"] is not None and coef[name]["p_value"] < 0.05
    findings = [
        f"Bigger islands do get more boats, but less than proportionally: rank correlation "
        f"{rho:.2f} for arrivals and {rho_vessels:.2f} for distinct vessels. Doubling the population goes "
        f"with about {2 ** elasticity:.2f}x the arrivals.",
        f"Population alone explains {pop_only['r2'] * 100:.0f}% of the differences in traffic between "
        f"islands; adding airport, capital, hospital and location raises that to {services['r2'] * 100:.0f}%.",
    ]
    for name, text in [("airport", "an airport"), ("atoll_capital", "being the atoll capital"),
                       ("in_kaafu", "being in Kaafu, near Malé")]:
        e = effect(name)
        if e is not None:
            findings.append(f"Holding the rest equal, {text} goes with {e * 100:+.0f}% arrivals"
                            f"{'' if significant(name) else ' (not statistically clear)'}.")
    e = effect("hospital_level")
    if e is not None:
        findings.append(f"Each step up in hospital level (health centre → atoll → regional → tertiary) goes with "
                        f"{e * 100:+.0f}% arrivals{'' if significant('hospital_level') else ' (not statistically clear)'}.")
    if fleet is not None:
        e = effect("log_home_fleet")
        direction = "more" if e and e > 0 else "less"
        findings.append(f"Adding each island's home fleet (boats that spend most nights there, mostly fishing "
                        f"and work vessels) raises the explained share to {full['r2'] * 100:.0f}%. Islands with "
                        f"twice the home fleet see {abs((2 ** coef['log_home_fleet']['estimate']) - 1) * 100:.0f}% "
                        f"{direction} traffic{'' if significant('log_home_fleet') else ' (not statistically clear)'}.")
    counts = result["jetty_case"].value_counts()
    findings.append("Verdicts: " + ", ".join(f"{k} {v}" for k, v in counts.items()) + ".")

    for model in models.values():
        model.pop("fitted", None)
    report = {
        "islands_in_model": int(len(sample)),
        "spearman_population_vs_arrivals": round(rho, 3),
        "spearman_population_vs_vessels": round(rho_vessels, 3),
        "arrivals_elasticity_to_population": round(elasticity, 3),
        "models": models,
        "findings": findings,
        "strong_cases": result.loc[result["jetty_case"].str.startswith("Strong"),
                                   ["island", "atoll", "population", "avg_arrivals_per_day",
                                    "traffic_vs_population", "pressure_score", "jetty_case",
                                    "reason"]].to_dict("records"),
        "notes": [
            "Traffic is August 2025 FollowMe tracker data; only vessels with trackers are counted.",
            "Population is Census 2022 Table P5 resident population.",
            "Pressure score is a 0-100 rank against other islands, not a measure of jetty capacity.",
            "Coefficients describe associations; they do not prove cause.",
        ],
    }
    OUT_JSON.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    log("\nFindings:")
    for line in findings:
        log(" -", line)
    log("\nTop jetty cases:")
    log(result[result["role"] == "island"][["island", "atoll", "population", "avg_arrivals_per_day",
                                            "traffic_vs_population", "pressure_score", "jetty_case"]]
        .head(12).to_string(index=False))
    log(f"\nWrote {OUT_CSV.relative_to(ROOT)} and {OUT_JSON.relative_to(ROOT)}")
    return report


if __name__ == "__main__":
    main()