"""
Jetty step for main.py. Runs three steps in order:

  Step 1  Island arrivals and departures from the ping files (jetty/island_visits.py).
          Skipped when the saved results are newer than the ping files and island list.
  Step 2  Save data/processed/departure_Arrival.csv, one row per island.
  Step 3  Does each island need a bigger jetty? (jetty/jetty_need.py), using step 2's file
          and data/Island_metrics.csv. Writes jetty_need.csv and jetty_need_model.json.

Progress messages go to stderr; only the returned dict ends up in main.py's JSON.
"""

import json
import sys

import pandas as pd

from jetty import island_visits, jetty_need

TOP_ISLANDS = None  # islands in results.json (None = all); the website table shows the busiest 25


def log(*parts) -> None:
    print(*parts, file=sys.stderr, flush=True)


def _needs_rerun(summary_csv) -> bool:
    if not summary_csv.exists():
        return True
    built = summary_csv.stat().st_mtime
    inputs = list(island_visits.PINGS_DIR.glob("*.csv")) + [island_visits.TARGETS_CSV]
    return any(path.stat().st_mtime > built for path in inputs if path.exists())


def run(analysis: dict | None = None) -> dict:
    summary_csv = island_visits.OUT_DIR / "island_summary.csv"
    daily_csv = island_visits.OUT_DIR / "island_daily_traffic.csv"
    arrivals_csv = island_visits.OUT_DIR / "departure_Arrival.csv"

    # Step 1: arrivals and departures per island
    if _needs_rerun(summary_csv):
        log("Step 1: finding island arrivals and departures from the ping files")
        try:
            island_visits.main()
        except SystemExit as stop:  # missing folders or files
            return {"summary": f"Island analysis did not run: {stop}", "islands": []}
    else:
        log("Step 1: arrivals and departures are up to date, reusing saved results")

    # Step 2: save departure_Arrival.csv, with each island's top 10 origins and destinations
    table = pd.read_csv(summary_csv).sort_values("total_arrivals", ascending=False)
    visits_csv = island_visits.OUT_DIR / "visits.csv"
    links = pd.DataFrame(columns=["island", "direction", "rank", "other_island", "trips", "share_pct"])
    if visits_csv.exists():
        visits = pd.read_csv(visits_csv, usecols=["island", "came_from", "went_to",
                                                  "arrival_counted", "departure_counted"])
        links = island_visits.connections(visits, table)
        table = island_visits.with_connection_lists(table, links)
        links.to_csv(island_visits.OUT_DIR / "island_connections.csv", index=False)
    table.to_csv(arrivals_csv, index=False)
    log(f"Step 2: saved {arrivals_csv.relative_to(island_visits.ROOT)} "
        f"(with top {island_visits.TOP_LINKS} origins and destinations per island)")

    # Step 3: is a bigger jetty needed?
    log("Step 3: checking which islands need a bigger jetty")
    try:
        report = jetty_need.main()
        need = {"findings": report["findings"], "strong_cases": report["strong_cases"]}
    except (SystemExit, FileNotFoundError) as problem:  # e.g. data/Island_metrics.csv missing
        log(f"Step 3 did not run: {problem}")
        need = {"findings": [f"Jetty need analysis did not run: {problem}"], "strong_cases": []}

    # Step 4: show the charts, only when you run main.py yourself in a terminal
    # (the website also runs main.py, and chart windows would freeze it)
    if sys.stdout.isatty():
        log("Step 4: opening charts")
        try:
            from jetty import jetty_plots
            jetty_plots.main()
        except ImportError:
            log("Step 4 skipped: install matplotlib (python -m pip install matplotlib)")
        except SystemExit as problem:
            log(f"Step 4 did not run: {problem}")

    dates = pd.read_csv(daily_csv, usecols=["date"])["date"]
    period = f"{dates.min()} to {dates.max()}"
    busiest = table.iloc[0]
    summary = (
        f"{len(table)} islands, {period}: {int(table['total_arrivals'].sum()):,} arrivals and "
        f"{int(table['total_departures'].sum()):,} departures. Busiest: {busiest['island']} "
        f"({busiest['atoll']}) with {int(busiest['total_arrivals']):,} arrivals, "
        f"about {busiest['avg_arrivals_per_day']:.1f} a day."
    )
    top = table if TOP_ISLANDS is None else table.head(TOP_ISLANDS)
    records = json.loads(top.drop(columns=["arrivals_from_top10", "departures_to_top10"], errors="ignore")
                         .to_json(orient="records"))  # every column; NaN becomes null
    for record in records:  # attach the top 10 lists as proper lists with numbers
        label = f"{record['island']} ({record['atoll']})"
        mine = links[links["island"] == label]
        for direction, key in [("arrived_from", "arrivals_from"), ("departed_to", "departures_to")]:
            rows = mine[mine["direction"] == direction]
            record[key] = [{"island": o, "trips": int(t), "share_pct": float(s)}
                           for o, t, s in zip(rows["other_island"], rows["trips"], rows["share_pct"])]
    return {
        "summary": summary,
        "period": period,
        "islands": records,
        "need": need,
    }