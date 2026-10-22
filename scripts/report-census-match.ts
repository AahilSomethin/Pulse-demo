/**
 * Prints Census 2022 matches against the reference islands already in public/reference.
 * Does not change either source file.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { joinCensus, type CensusIsland } from "../src/lib/reference/census";
import { parseGeoJson } from "../src/lib/parsing/geojson";

async function main() {
  const censusPath = path.resolve("public/reference/census-2022.json");
  const islandsPath = path.resolve("public/reference/osm-islands.geojson");
  const census = JSON.parse(await readFile(censusPath, "utf8")) as { islands?: CensusIsland[]; referenceYear?: number };
  const geography = parseGeoJson(await readFile(islandsPath, "utf8"));
  const rows = Array.isArray(census.islands) ? census.islands : [];
  const places = geography.polygons
    .filter((polygon) => polygon.name && !polygon.synthetic)
    .map((polygon) => ({ name: polygon.name as string, atoll: polygon.atoll }));
  const join = joinCensus(places, rows);
  const byMethod = { code: 0, atoll_name: 0, unique_name: 0 };
  for (const match of join.matched) byMethod[match.method] += 1;
  const admin = rows.filter((row) => !row.ward);
  const unmatchedAdmin = join.unmatchedCensus.filter((row) => admin.some((island) => island.name === row.name && island.atoll === row.atoll));

  console.log(`reference year ${census.referenceYear ?? "unknown"}`);
  console.log(`census rows ${rows.length} (${admin.length} admin islands)`);
  console.log(`named reference polygons ${places.length}`);
  console.log(`matched ${join.matched.length} (code ${byMethod.code}, atoll+name ${byMethod.atoll_name}, unique name ${byMethod.unique_name})`);
  console.log(`ambiguous ${join.ambiguous.length}`);
  console.log(`unmatched census ${join.unmatchedCensus.length} (admin ${unmatchedAdmin.length})`);
  console.log(`unmatched reference places ${join.unmatchedPlaces.length}`);
  console.log("\nAmbiguous");
  for (const item of join.ambiguous) {
    console.log(`- ${item.atoll ?? "no atoll"} ${item.name}: ${item.reason} [${item.candidates.join("; ")}]`);
  }
  console.log("\nUnmatched census");
  for (const item of join.unmatchedCensus) console.log(`- ${item.atoll ?? "no atoll"} ${item.name}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
