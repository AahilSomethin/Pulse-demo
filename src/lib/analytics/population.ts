/**
 * Population is context from a verified census table.
 * A missing or ambiguous island stays empty. Nothing here is a demand or isolation score.
 */
export interface PopulationQuery {
  name: string;
  atoll?: string | null;
  code?: string | null;
}

export interface PopulationLookup {
  status: "matched" | "ambiguous" | "unmatched" | "unavailable";
  population: number | null;
  year: 2022 | null;
}

export interface PopulationSource {
  lookup(query: PopulationQuery): PopulationLookup;
}

export const emptyPopulation: PopulationSource = {
  lookup: () => ({ status: "unavailable", population: null, year: null }),
};
