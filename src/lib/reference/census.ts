import { canonicalAtoll, normalisePlaceName, type AtollCode } from "@/lib/reference/atolls";
import type { PopulationLookup } from "@/lib/analytics/population";

export interface CensusIsland {
  code: string | null;
  name: string;
  atoll: AtollCode | null;
  population: number;
  maldivian: number | null;
  foreign: number | null;
  /** Male ward or harbour count from Table P5. Not part of the admin-island total. */
  ward: boolean;
}

export interface CensusTable {
  referenceYear: 2022;
  adminTotal: number;
  islands: CensusIsland[];
}

export interface CensusPlace {
  code?: string | null;
  name: string;
  atoll?: string | null;
}

export interface CensusMatch {
  placeName: string;
  censusName: string;
  atoll: string | null;
  population: number;
  method: "code" | "atoll_name" | "unique_name";
}

export interface CensusAmbiguity {
  name: string;
  atoll: string | null;
  candidates: string[];
  reason: string;
}

export interface CensusNameRef {
  name: string;
  atoll: string | null;
}

export interface CensusJoin {
  lookup(place: CensusPlace): PopulationLookup;
  populationForIsland(name: string): number | null;
  populationForCode(code: string): number | null;
  matched: CensusMatch[];
  ambiguous: CensusAmbiguity[];
  unmatchedCensus: CensusNameRef[];
  unmatchedPlaces: CensusNameRef[];
}

const MALE_SECTION = new Set(["republic", "maale", "male"]);

function placeKey(atoll: string | null, name: string): string {
  return `${atoll ?? ""}|${normalisePlaceName(name)}`;
}

function censusLabel(row: CensusIsland): string {
  return row.atoll ? `${row.atoll} ${row.name}` : row.name;
}

function cellText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function cellCount(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (Math.abs(numeric - rounded) > 1e-6 || rounded < 0) return null;
  return rounded;
}

/**
 * Reads Maldives Bureau of Statistics Table P5 (resident population by island and sex, 2022).
 * Admin-island rows must sum to the published Admin islands total. Malé wards are kept separate.
 */
export function parseCensusP5(rows: readonly (readonly unknown[])[]): CensusTable {
  let adminTotal: number | null = null;
  let inAdmin = false;
  const islands: CensusIsland[] = [];

  for (const row of rows) {
    const atollText = cellText(row[0]);
    const name = cellText(row[1]).replace(/&amp;/g, "&");
    const population = cellCount(row[2]);
    const nameKey = normalisePlaceName(name);
    if (!name) continue;
    if (nameKey === "admin islands") {
      if (population == null) throw new Error("Table P5 Admin islands total is not a whole number.");
      adminTotal = population;
      inAdmin = true;
      continue;
    }
    if (nameKey === "non admin islands" || nameKey === "nonadmin islands") {
      inAdmin = false;
      continue;
    }
    if (MALE_SECTION.has(nameKey) || population == null) continue;

    const atoll = canonicalAtoll(atollText);
    if (inAdmin) {
      if (!atoll) throw new Error(`Table P5 admin row "${name}" has no recognised atoll.`);
      islands.push({
        code: null,
        name,
        atoll,
        population,
        maldivian: cellCount(row[5]),
        foreign: cellCount(row[8]),
        ward: false,
      });
      continue;
    }
    if (!atollText) {
      islands.push({
        code: null,
        name,
        atoll: "K",
        population,
        maldivian: cellCount(row[5]),
        foreign: cellCount(row[8]),
        ward: true,
      });
    }
  }

  if (adminTotal == null) throw new Error("Table P5 is missing the Admin islands total.");
  const adminRows = islands.filter((row) => !row.ward);
  if (adminRows.length === 0) throw new Error("Table P5 has no admin island rows.");
  const sum = adminRows.reduce((total, row) => total + row.population, 0);
  if (sum !== adminTotal) {
    throw new Error(`Table P5 admin islands sum to ${sum}, but the sheet total is ${adminTotal}.`);
  }
  return { referenceYear: 2022, adminTotal, islands };
}

export function parseCensusCsv(text: string): CensusIsland[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("The census file has no rows.");
  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const nameIndex = header.findIndex((cell) => cell === "name" || cell === "island" || cell === "island_name");
  const populationIndex = header.findIndex((cell) => cell === "population" || cell === "pop" || cell === "resident_population");
  const codeIndex = header.findIndex((cell) => cell === "code" || cell === "island_code");
  const atollIndex = header.findIndex((cell) => cell === "atoll");
  if (nameIndex < 0 || populationIndex < 0) {
    throw new Error("The census file needs a name or island column and a population column.");
  }
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const population = Number(cells[populationIndex]);
    if (!Number.isFinite(population)) throw new Error(`Population is not a number for ${cells[nameIndex] || "a row"}.`);
    return {
      code: codeIndex >= 0 ? cells[codeIndex] || null : null,
      name: cells[nameIndex] ?? "",
      atoll: canonicalAtoll(atollIndex >= 0 ? cells[atollIndex] : null),
      population,
      maldivian: null,
      foreign: null,
      ward: false,
    };
  }).filter((row) => row.name.length > 0);
}

function indexRows(rows: readonly CensusIsland[]): Map<string, CensusIsland[]> {
  const index = new Map<string, CensusIsland[]>();
  for (const row of rows) {
    const key = placeKey(row.atoll, row.name);
    const list = index.get(key);
    if (list) list.push(row);
    else index.set(key, [row]);
  }
  return index;
}

/**
 * Joins census rows to named places.
 * A match needs the same official code, the same atoll plus island name, or a name that is unique on both sides.
 * Near spells and conflicting atolls stay unmatched.
 */
export function joinCensus(places: readonly CensusPlace[], rows: readonly CensusIsland[]): CensusJoin {
  const seenPlaces = new Set<string>();
  const uniquePlaces: CensusPlace[] = [];
  for (const place of places) {
    if (!place.name.trim()) continue;
    const key = `${place.code?.trim().toLowerCase() ?? ""}|${placeKey(canonicalAtoll(place.atoll), place.name)}`;
    if (seenPlaces.has(key)) continue;
    seenPlaces.add(key);
    uniquePlaces.push(place);
  }
  places = uniquePlaces;
  const byCode = new Map<string, CensusIsland>();
  const duplicateCodes = new Set<string>();
  for (const row of rows) {
    const code = row.code?.trim().toLowerCase();
    if (!code) continue;
    if (byCode.has(code) || duplicateCodes.has(code)) {
      byCode.delete(code);
      duplicateCodes.add(code);
      continue;
    }
    byCode.set(code, row);
  }
  const byAtollName = indexRows(rows);
  const byName = new Map<string, CensusIsland[]>();
  for (const row of rows) {
    const key = normalisePlaceName(row.name);
    const list = byName.get(key);
    if (list) list.push(row);
    else byName.set(key, [row]);
  }
  const placeNameCount = new Map<string, number>();
  for (const place of places) {
    if (!place.name.trim()) continue;
    const key = normalisePlaceName(place.name);
    placeNameCount.set(key, (placeNameCount.get(key) ?? 0) + 1);
  }

  const matched: CensusMatch[] = [];
  const ambiguous: CensusAmbiguity[] = [];
  const unmatchedPlaces: CensusNameRef[] = [];
  const used = new Set<CensusIsland>();
  const stored = new Map<string, PopulationLookup>();
  const byPlaceName = new Map<string, PopulationLookup[]>();

  function remember(place: CensusPlace, lookup: PopulationLookup) {
    const atoll = canonicalAtoll(place.atoll);
    stored.set(placeKey(atoll, place.name), lookup);
    const nameKey = normalisePlaceName(place.name);
    const list = byPlaceName.get(nameKey);
    if (list) list.push(lookup);
    else byPlaceName.set(nameKey, [lookup]);
  }

  for (const place of places) {
    if (!place.name.trim()) continue;
    const atoll = canonicalAtoll(place.atoll);
    const code = place.code?.trim().toLowerCase();
    const coded = code && !duplicateCodes.has(code) ? byCode.get(code) : undefined;
    if (coded) {
      const lookup: PopulationLookup = { status: "matched", population: coded.population, year: 2022, method: "code" };
      matched.push({ placeName: place.name, censusName: coded.name, atoll: coded.atoll, population: coded.population, method: "code" });
      used.add(coded);
      remember(place, lookup);
      continue;
    }

    if (atoll) {
      const candidates = byAtollName.get(placeKey(atoll, place.name)) ?? [];
      if (candidates.length === 1) {
        const row = candidates[0];
        matched.push({ placeName: place.name, censusName: row.name, atoll: row.atoll, population: row.population, method: "atoll_name" });
        used.add(row);
        remember(place, { status: "matched", population: row.population, year: 2022, method: "atoll_name" });
        continue;
      }
      if (candidates.length > 1) {
        ambiguous.push({
          name: place.name,
          atoll,
          candidates: candidates.map(censusLabel),
          reason: "More than one Census 2022 row has this atoll and island name.",
        });
        remember(place, { status: "ambiguous", population: null, year: 2022, method: null });
        continue;
      }
      const sameName = byName.get(normalisePlaceName(place.name)) ?? [];
      if (sameName.length > 1) {
        ambiguous.push({
          name: place.name,
          atoll,
          candidates: sameName.map(censusLabel),
          reason: "This island name occurs in more than one atoll, and none share this place's atoll.",
        });
        remember(place, { status: "ambiguous", population: null, year: 2022, method: null });
      } else {
        unmatchedPlaces.push({ name: place.name, atoll });
        remember(place, { status: "unmatched", population: null, year: 2022, method: null });
      }
      continue;
    }

    const sameName = byName.get(normalisePlaceName(place.name)) ?? [];
    if (sameName.length > 1) {
      ambiguous.push({
        name: place.name,
        atoll: null,
        candidates: sameName.map(censusLabel),
        reason: "This island name occurs in more than one atoll, and the place has no atoll to choose one.",
      });
      remember(place, { status: "ambiguous", population: null, year: 2022, method: null });
      continue;
    }
    if (sameName.length === 1 && placeNameCount.get(normalisePlaceName(place.name)) === 1) {
      const row = sameName[0];
      matched.push({ placeName: place.name, censusName: row.name, atoll: row.atoll, population: row.population, method: "unique_name" });
      used.add(row);
      remember(place, { status: "matched", population: row.population, year: 2022, method: "unique_name" });
      continue;
    }
    unmatchedPlaces.push({ name: place.name, atoll: null });
    remember(place, { status: "unmatched", population: null, year: 2022, method: null });
  }

  const unmatchedCensus = rows.filter((row) => !used.has(row)).map((row) => ({ name: row.name, atoll: row.atoll }));

  return {
    lookup(place: CensusPlace): PopulationLookup {
      const code = place.code?.trim().toLowerCase();
      if (code && byCode.has(code)) {
        const row = byCode.get(code);
        if (row) return { status: "matched", population: row.population, year: 2022, method: "code" };
      }
      const atoll = canonicalAtoll(place.atoll);
      const storedHit = stored.get(placeKey(atoll, place.name));
      if (storedHit) return storedHit;
      const nameHits = byName.get(normalisePlaceName(place.name)) ?? [];
      if (!atoll && nameHits.length > 1) return { status: "ambiguous", population: null, year: 2022, method: null };
      return { status: "unmatched", population: null, year: 2022, method: null };
    },
    populationForIsland(name: string) {
      const hits = byPlaceName.get(normalisePlaceName(name)) ?? [];
      if (hits.length !== 1 || hits[0].status !== "matched") return null;
      return hits[0].population;
    },
    populationForCode(code: string) {
      return byCode.get(code.trim().toLowerCase())?.population ?? null;
    },
    matched,
    ambiguous,
    unmatchedCensus,
    unmatchedPlaces,
  };
}
