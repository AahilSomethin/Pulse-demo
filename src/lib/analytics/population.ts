/**
 * Census population is not in this workspace.
 * A later adapter can implement this without changing the network page.
 */
export interface PopulationSource {
  populationForIsland(name: string): number | null;
}

export const emptyPopulation: PopulationSource = {
  populationForIsland: () => null,
};
