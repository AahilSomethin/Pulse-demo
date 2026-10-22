/**
 * Reads Maldives Bureau of Statistics Table P5 and writes a JSON lookup.
 * The workbook is not modified. Pass another .xlsx path as the first argument to override the default.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { readSheet } from "read-excel-file/node";

import { parseCensusP5 } from "../src/lib/reference/census";

async function main() {
  const source = process.argv[2] ?? path.resolve("data/Census 2022/P5.xlsx");
  const matrix = await readSheet(source, "P5");
  const table = parseCensusP5(matrix);
  const target = path.resolve("public/reference/census-2022.json");
  await mkdir(path.dirname(target), { recursive: true });
  const islands = table.islands.filter((row) => !row.ward);
  const wards = table.islands.filter((row) => row.ward);
  await writeFile(target, `${JSON.stringify({
    source: "Maldives Bureau of Statistics",
    table: "P5",
    title: "Resident Population by island and sex, 2022",
    referenceYear: table.referenceYear,
    adminTotal: table.adminTotal,
    importedAt: new Date().toISOString(),
    islands: table.islands,
    note: "Resident population is context beside a named island. It is not a passenger count, a demand model, or an isolation score. Islands that do not match on atoll and name stay blank.",
  }, null, 2)}\n`);
  console.log(`wrote ${islands.length} admin islands and ${wards.length} Malé wards to ${target}`);
  console.log(`admin total ${table.adminTotal}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
