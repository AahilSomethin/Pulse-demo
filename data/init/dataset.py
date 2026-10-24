"""Loads basic facts about the FollowMe ping files for analysis/metrics.py."""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
PINGS_DIR = DATA_DIR / "FollowMe_august_2025"
CACHE = DATA_DIR / "processed" / "dataset_cache.json"


def _count_rows(path: Path) -> int:
    with path.open("rb") as handle:
        lines = sum(chunk.count(b"\n") for chunk in iter(lambda: handle.read(1 << 20), b""))
    return max(lines - 1, 0)  # minus the header


def load_dataset() -> dict:
    files = sorted(PINGS_DIR.glob("*.csv"), key=lambda p: (len(p.stem), p.stem))
    signature = {p.name: p.stat().st_mtime for p in files}
    if CACHE.exists():
        cached = json.loads(CACHE.read_text())
        if cached.get("signature") == signature:
            return cached["dataset"]
    dataset = {"row_count": sum(_count_rows(p) for p in files), "file_count": len(files)}
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"signature": signature, "dataset": dataset}))
    return dataset
