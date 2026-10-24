"""Runs every SeaPulse step and prints one JSON result for the website. Usage: python main.py"""

import json
import os
import sys

FEATURES = {
    "data": True,
    "analysis": True,
    "visuals": True,
    "coastguard": True,
    "marine_org": True,
    "jetty": True,
}


def _enabled(name: str) -> bool:
    override = os.environ.get(f"SEAPULSE_{name.upper()}")
    if override is None:
        return FEATURES[name]
    return override.lower() not in {"0", "false", "off"}


def main() -> dict:
    dataset: dict = {}
    analysis: dict = {}

    if _enabled("data"):
        from data.dataset import load_dataset

        dataset = load_dataset()

    if _enabled("analysis"):
        from analysis.metrics import analyze

        analysis = analyze(dataset)

    visuals: dict = {}
    if _enabled("visuals"):
        from visuals.series import prepare

        visuals = prepare(analysis)

    coastguard: dict = {}
    if _enabled("coastguard"):
        from coastguard.feature import run as run_coastguard

        coastguard = run_coastguard(analysis)

    marine_org: dict = {}
    if _enabled("marine_org"):
        from marine_org.feature import run as run_marine_org

        marine_org = run_marine_org(analysis)

    jetty: dict = {}
    if _enabled("jetty"):
        from jetty.feature import run as run_jetty

        jetty = run_jetty(analysis)

    return {
        "analysis": analysis,
        "visuals": visuals,
        "coastguard": coastguard,
        "marine_org": marine_org,
        "jetty": jetty,
    }


if name == "main":
    from pathlib import Path

    result = main()
    text = json.dumps(result, indent=2, default=str)

    out = Path(file).resolve().parent / "data" / "processed" / "results.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")

    if sys.stdout.isatty():
        # run by you in a terminal: just say where it went
        print(f"Saved results to {out}", file=sys.stderr)
    else:
        # run by the website: it reads the JSON from here
        sys.stdout.write(text)