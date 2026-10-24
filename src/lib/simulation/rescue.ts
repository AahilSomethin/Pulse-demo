import { distanceToSegmentM } from "@/lib/geo/distance";
import { maskDevice } from "@/lib/format";
import type { Journey } from "@/types/maritime";

export interface RoutePass {
  routeKey: string;
  label: string;
  distanceM: number;
  originLon: number;
  originLat: number;
  destinationLon: number;
  destinationLat: number;
}

/** Stable id for one dwell-to-dwell passage on one device. */
export function routeKey(journey: Journey): string {
  return `${journey.device}:${journey.origin.startMs}:${journey.destination.startMs}`;
}

export function routeLabel(journey: Journey): string {
  return `${stopLabel(journey.origin)} to ${stopLabel(journey.destination)}`;
}

/** Rounded so a moved pin is a new consent, and a repeat click is the same pin. */
export function incidentKey(incident: { lat: number; lon: number }): string {
  return `${incident.lat.toFixed(5)},${incident.lon.toFixed(5)}`;
}

/** Devices that have at least one credible passage, in index order. */
export function boatRoster(journeys: readonly Journey[]): number[] {
  const ids = new Set<number>();
  for (const journey of journeys) {
    if (journey.credible) ids.add(journey.device);
  }
  return [...ids].sort((a, b) => a - b);
}

/** Demo label. The masked id is the same mask used everywhere else. */
export function boatLabel(roster: readonly number[], device: number, name: string): string {
  const index = roster.indexOf(device);
  const prefix = index >= 0 ? `Boat ${index + 1}` : "Boat";
  return `${prefix} · ${maskDevice(name)}`;
}

export function routesForDevice(journeys: readonly Journey[], device: number): Journey[] {
  return journeys.filter((journey) => journey.device === device && journey.credible);
}

/**
 * Credible passages whose straight line comes within `radiusM` of the pin.
 * Closest first. A coverage gap or a same-island passage is not an offer.
 */
export function passesNearIncident(
  journeys: readonly Journey[],
  device: number,
  incident: { lat: number; lon: number },
  radiusM: number,
): RoutePass[] {
  if (!(radiusM > 0) || !Number.isFinite(incident.lat) || !Number.isFinite(incident.lon)) return [];
  const passes: RoutePass[] = [];
  for (const journey of routesForDevice(journeys, device)) {
    const distance = distanceToSegmentM(
      incident.lon,
      incident.lat,
      journey.origin.lon,
      journey.origin.lat,
      journey.destination.lon,
      journey.destination.lat,
    );
    if (distance <= radiusM) {
      passes.push({
        routeKey: routeKey(journey),
        label: routeLabel(journey),
        distanceM: distance,
        originLon: journey.origin.lon,
        originLat: journey.origin.lat,
        destinationLon: journey.destination.lon,
        destinationLat: journey.destination.lat,
      });
    }
  }
  passes.sort((a, b) => a.distanceM - b.distanceM || a.label.localeCompare(b.label));
  return passes;
}

export function routeBounds(journeys: readonly Journey[]): { west: number; south: number; east: number; north: number } | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const journey of journeys) {
    for (const point of [journey.origin, journey.destination]) {
      west = Math.min(west, point.lon);
      east = Math.max(east, point.lon);
      south = Math.min(south, point.lat);
      north = Math.max(north, point.lat);
    }
  }
  if (!Number.isFinite(west)) return null;
  const padLon = Math.max(0.02, (east - west) * 0.15);
  const padLat = Math.max(0.02, (north - south) * 0.15);
  return { west: west - padLon, south: south - padLat, east: east + padLon, north: north + padLat };
}

function stopLabel(stop: Journey["origin"]): string {
  return stop.islandName ?? stop.placeName ?? stop.areaLabel;
}
