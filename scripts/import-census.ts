/**
 * Reads a local census CSV and writes a JSON lookup.
 * The CSV must contain name (or island) and population columns.
 * Pass the file path as the first argument. Nothing is invented for missing cells.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { parseCensusCsv } from "../src/lib/reference/census";

async function main() {
const source = process.argv[2];
if (!source) {
  console.error("Usage: npm run data:census -- path/to/census.csv");
  console.error("No official Census 2022 table is bundled. Without that file, population stays unavailable.");
  process.exitCode = 1;
  return;
}

const rows = parseCensusCsv(await readFile(source, "utf8"));
const target = path.resolve("public/reference/census-2022.json");
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify({
  source: "Maldives Bureau of Statistics Census 2022",
  importedAt: new Date().toISOString(),
  islands: rows,
  note: "Population is context beside observed connectivity. It is not a passenger accessibility index.",
}, null, 2)}\n`);
console.log(`wrote ${rows.length} islands to ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
