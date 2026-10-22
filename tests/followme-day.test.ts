import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseDataset } from "@/lib/parsing/load-csv";

const dayPath = resolve(process.cwd(), "data/FollowMe/FollowMe_august_2025/1.csv");
const qualityPath = resolve(process.cwd(), "src/data/followme-quality.json");
const available = existsSync(dayPath) && existsSync(qualityPath);

describe.skipIf(!available)("real FollowMe day", () => {
  it("matches the aggregate day count and keeps identifiers out of the assertion", () => {
    const quality = JSON.parse(readFileSync(qualityPath, "utf8")) as {
      days: { day: string; rowsKept: number; devices: number }[];
    };
    const expected = quality.days.find((day) => day.day === "1");
    const dataset = parseDataset(readFileSync(dayPath, "utf8"), "1.csv");
    expect(expected).toBeTruthy();
    expect(dataset.kept).toBe(expected?.rowsKept);
    expect(dataset.names.length).toBe(expected?.devices);
    expect(dataset.periodLabel).toBe("August 2025");
    expect(dataset.synthetic).toBe(false);
    expect(dataset.t0).toBeLessThan(dataset.t1);
    expect(dataset.names.every((name) => name.length > 0)).toBe(true);
  }, 120_000);
});
