import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";

import { canonicalAtoll } from "@/lib/reference/atolls";
import { joinCensus, parseCensusP5, type CensusIsland } from "@/lib/reference/census";

function island(atoll: string, name: string, population: number): unknown[] {
  const cells: unknown[] = Array.from({ length: 12 }, () => null);
  cells[0] = atoll;
  cells[1] = name;
  cells[2] = population;
  cells[5] = population;
  cells[8] = 0;
  return cells;
}

function table(): CensusIsland[] {
  return parseCensusP5([
    ["Table P5"],
    [null, "Republic", 250],
    [null, "Maale", 50],
    [null, "Henveiru", 50],
    [null, "Admin islands", 200],
    island("HA", "Baarah", 40),
    island("R", "Meedhoo", 80),
    island("Adh", "Meedhoo", 80),
    [null, "Non-admin islands", 10],
  ]).islands;
}

describe("census table P5", () => {
  it("keeps admin islands and Malé wards, and checks the admin total", () => {
    const parsed = parseCensusP5([
      [null, "Republic", 250],
      [null, "Maale", 50],
      [null, "Henveiru", 50],
      [null, "Admin islands", 200],
      island("Haa Alifu", "Baarah", 40),
      island("R", "Meedhoo", 80),
      island("Alif Dhaalu", "Meedhoo", 80),
    ]);
    expect(parsed.adminTotal).toBe(200);
    expect(parsed.referenceYear).toBe(2022);
    expect(parsed.islands.filter((row) => !row.ward).map((row) => row.atoll)).toEqual(["HA", "R", "Adh"]);
    expect(parsed.islands.find((row) => row.ward)).toMatchObject({ name: "Henveiru", atoll: "K", population: 50 });
  });

  it("parses the local Table P5 workbook when that file is present", async () => {
    const source = "data/Census 2022/P5.xlsx";
    if (!existsSync(source)) return;
    const parsed = parseCensusP5(await readSheet(source, "P5"));
    const admin = parsed.islands.filter((row) => !row.ward);
    expect(parsed.adminTotal).toBe(236911);
    expect(admin).toHaveLength(186);
    expect(admin.reduce((total, row) => total + row.population, 0)).toBe(236911);
    expect(new Set(admin.map((row) => row.atoll)).size).toBeGreaterThan(15);
  });

  it("rejects an admin total that does not match the island rows", () => {
    expect(() => parseCensusP5([
      [null, "Admin islands", 10],
      island("HA", "Baarah", 40),
    ])).toThrow(/sum to 40/);
  });
});

describe("census join", () => {
  const rows = table();

  it("matches atoll plus name and leaves a repeated name unmatched without an atoll", () => {
    const join = joinCensus([
      { name: "Meedhoo", atoll: "Raa" },
      { name: "Meedhoo", atoll: null },
      { name: "Baarah", atoll: null },
      { name: "Nowhere", atoll: "HA" },
    ], rows);
    expect(join.lookup({ name: "Meedhoo", atoll: "Raa" })).toEqual({ status: "matched", population: 80, year: 2022 });
    expect(join.lookup({ name: "Meedhoo" }).status).toBe("ambiguous");
    expect(join.lookup({ name: "Meedhoo" }).population).toBeNull();
    expect(join.lookup({ name: "Baarah" }).population).toBe(40);
    expect(join.lookup({ name: "Nowhere", atoll: "HA" })).toMatchObject({ status: "unmatched", population: null });
    expect(join.ambiguous.some((item) => item.name === "Meedhoo")).toBe(true);
    expect(join.unmatchedPlaces.some((item) => item.name === "Nowhere")).toBe(true);
  });

  it("does not use a unique name when the atoll disagrees", () => {
    const join = joinCensus([{ name: "Baarah", atoll: "Seenu" }], rows);
    expect(join.lookup({ name: "Baarah", atoll: "S" }).status).not.toBe("matched");
    expect(join.matched).toHaveLength(0);
    expect(join.unmatchedCensus.some((item) => item.name === "Baarah")).toBe(true);
  });

  it("recognises full atoll names", () => {
    expect(canonicalAtoll("North Miladhunmadulu")).toBe("Sh");
    expect(canonicalAtoll("Gaafu Dhaalu Atoll")).toBe("GDh");
    expect(canonicalAtoll("HDh")).toBe("HDh");
    expect(canonicalAtoll("not an atoll")).toBeNull();
  });
});
