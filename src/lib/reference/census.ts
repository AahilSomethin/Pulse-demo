export interface CensusIsland {
  code: string | null;
  name: string;
  atoll: string | null;
  population: number;
}

export interface CensusJoin {
  populationForIsland(name: string): number | null;
  populationForCode(code: string): number | null;
  matchedNames: string[];
  unmatchedCensus: string[];
}

export function normalisePlaceName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Joins census rows onto island names or codes. Code wins. Names must match
 * after normalisation. Near matches are left unmatched on purpose.
 */
export function joinCensus(
  islands: readonly { code?: string | null; name: string }[],
  rows: readonly CensusIsland[],
): CensusJoin {
  const byCode = new Map<string, CensusIsland>();
  const byName = new Map<string, CensusIsland[]>();
  for (const row of rows) {
    if (row.code) byCode.set(row.code.trim().toLowerCase(), row);
    const key = normalisePlaceName(row.name);
    const list = byName.get(key);
    if (list) list.push(row);
    else byName.set(key, [row]);
  }
  const matched = new Map<string, number>();
  const used = new Set<CensusIsland>();
  for (const island of islands) {
    const code = island.code?.trim().toLowerCase();
    const byOfficialCode = code ? byCode.get(code) : undefined;
    if (byOfficialCode) {
      matched.set(normalisePlaceName(island.name), byOfficialCode.population);
      used.add(byOfficialCode);
      continue;
    }
    const candidates = byName.get(normalisePlaceName(island.name)) ?? [];
    if (candidates.length === 1) {
      matched.set(normalisePlaceName(island.name), candidates[0].population);
      used.add(candidates[0]);
    }
  }
  return {
    populationForIsland(name: string) {
      return matched.get(normalisePlaceName(name)) ?? null;
    },
    populationForCode(code: string) {
      return byCode.get(code.trim().toLowerCase())?.population ?? null;
    },
    matchedNames: [...matched.keys()],
    unmatchedCensus: rows.filter((row) => !used.has(row)).map((row) => row.name),
  };
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
      atoll: atollIndex >= 0 ? cells[atollIndex] || null : null,
      population,
    };
  }).filter((row) => row.name.length > 0);
}
