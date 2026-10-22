/**
 * Population is context from a verified census table.
 * A missing or ambiguous island stays empty. Nothing here is a demand or isolation score.
 */
export interface PopulationQuery {
  name: string;
  atoll?: string | null;
  code?: string | null;
}

export type CensusMatchMethod = "code" | "atoll_name" | "unique_name";

export interface PopulationLookup {
  status: "matched" | "ambiguous" | "unmatched" | "unavailable";
  population: number | null;
  year: 2022 | null;
  /** Set only for a match. Atoll-and-name is a stronger confirmation than a unique name alone. */
  method: CensusMatchMethod | null;
}

export interface PopulationSource {
  lookup(query: PopulationQuery): PopulationLookup;
}

export const emptyPopulation: PopulationSource = {
  lookup: () => ({ status: "unavailable", population: null, year: null, method: null }),
};
