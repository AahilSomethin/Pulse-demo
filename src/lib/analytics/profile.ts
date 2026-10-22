import { durationVariability, passagesPerObservedDay, type ConnectionIndicator } from "@/lib/analytics/connectivity";
import { emptyPopulation, type CensusMatchMethod, type PopulationSource } from "@/lib/analytics/population";
import { boundsCenter, ringBounds } from "@/lib/geo/bounds";
import type { LandPolygon } from "@/types/maritime";

export interface ProfileLink {
  indicator: ConnectionIndicator;
  direction: "arrival" | "departure";
  other: ConnectionIndicator["origin"];
}

export interface LocationProfile {
  id: string;
  label: string;
  confidence: ConnectionIndicator["origin"]["confidence"];
  atoll: string | null;
  lat: number;
  lon: number;
  arrivals: number;
  departures: number;
  vessels: number;
  links: ProfileLink[];
  observationDays: number;
  periodLabel: string;
  scope: ConnectionIndicator["scope"];
  population: number | null;
  populationStatus: "matched" | "ambiguous" | "unmatched" | "not_applicable" | "unavailable";
  populationMethod: CensusMatchMethod | null;
  populationYear: 2022 | null;
  nameDv: string | null;
  warnings: string[];
}

function endpointMatches(endpoint: ConnectionIndicator["origin"], id: string): boolean {
  return endpoint.id === id || endpoint.sourceId === id || endpoint.label === id;
}

export function buildLocationProfile(
  id: string,
  indicators: readonly ConnectionIndicator[],
  population: PopulationSource = emptyPopulation,
): LocationProfile | null {
  const links: ProfileLink[] = [];
  for (const indicator of indicators) {
    if (endpointMatches(indicator.origin, id)) links.push({ indicator, direction: "departure", other: indicator.destination });
    if (endpointMatches(indicator.destination, id)) links.push({ indicator, direction: "arrival", other: indicator.origin });
  }
  if (links.length === 0) return null;
  const sample = links[0].direction === "departure" ? links[0].indicator.origin : links[0].indicator.destination;
  let arrivals = 0;
  let departures = 0;
  let busiest = 0;
  for (const link of links) {
    if (link.direction === "arrival") arrivals += link.indicator.passages;
    else departures += link.indicator.passages;
    busiest = Math.max(busiest, link.indicator.vessels);
  }
  const named = sample.label.split(" · ")[0];
  const populationLookup = sample.confidence === "named_polygon"
    ? population.lookup({ name: named, atoll: sample.atoll })
    : { status: "not_applicable" as const, population: null, year: null, method: null };
  const warnings = [
    "Counts are tracked vessels in the loaded observations. They are not ferry passengers or proof that an unlisted place has no service.",
  ];
  if (sample.confidence === "inferred") warnings.push("This is an inferred activity cluster, not a confirmed island or harbour.");
  if (links.some((link) => link.indicator.evidence === "insufficient")) warnings.push("Some connections have too few journeys for a stable typical time.");
  if (links.some((link) => link.indicator.excluded > 0)) warnings.push("Journeys with tracking gaps are counted in coverage and left out of typical times.");
  return {
    id: sample.id,
    label: sample.label,
    confidence: sample.confidence,
    atoll: sample.atoll,
    lat: sample.lat,
    lon: sample.lon,
    arrivals,
    departures,
    vessels: busiest,
    links: links.sort((a, b) => b.indicator.passages - a.indicator.passages),
    observationDays: links[0].indicator.observationDays,
    periodLabel: links[0].indicator.periodLabel,
    scope: links[0].indicator.scope,
    population: populationLookup.population,
    populationStatus: populationLookup.status,
    populationMethod: populationLookup.method,
    populationYear: populationLookup.year,
    nameDv: null,
    warnings,
  };
}

/** A named island with no passages still opens. Population stays geographic context. */
export function buildIslandProfile(
  polygon: LandPolygon,
  indicators: readonly ConnectionIndicator[],
  population: PopulationSource = emptyPopulation,
): LocationProfile {
  const linked = buildLocationProfile(polygon.id, indicators, population);
  if (linked) return { ...linked, nameDv: polygon.nameDv ?? null };
  const lookup = polygon.name
    ? population.lookup({ name: polygon.name, atoll: polygon.atoll })
    : { status: "unmatched" as const, population: null, year: 2022 as const, method: null };
  const center = boundsCenter(ringBounds(polygon.rings) ?? { west: 73.5, south: 4.2, east: 73.5, north: 4.2 });
  return {
    id: polygon.id,
    label: polygon.name ?? "Unnamed island",
    confidence: "named_polygon",
    atoll: polygon.atoll,
    lat: center.lat,
    lon: center.lon,
    arrivals: 0,
    departures: 0,
    vessels: 0,
    links: [],
    observationDays: indicators[0]?.observationDays ?? 1,
    periodLabel: indicators[0]?.periodLabel ?? "Current window",
    scope: indicators[0]?.scope ?? "day",
    population: lookup.population,
    populationStatus: polygon.name ? lookup.status : "unmatched",
    populationMethod: lookup.method,
    populationYear: lookup.year,
    nameDv: polygon.nameDv ?? null,
    warnings: [
      "No observed passages in this window use this island as an endpoint.",
      "Resident population is geographic context. It is not a passenger count or proof of transport demand.",
    ],
  };
}

export function profileFrequency(link: ProfileLink): string {
  const rate = passagesPerObservedDay(link.indicator);
  if (rate == null) return "No credible journeys in this window.";
  const variability = durationVariability(link.indicator);
  const spread = variability == null ? "" : ` Variability ${(variability * 100).toFixed(0)}% of the typical time.`;
  return `${rate.toFixed(1)} credible journeys per day in this window.${spread}`;
}
