import { AREA_CELL_DEG, DWELL_MAX_GAP_MS, DWELL_MIN_MS, DWELL_RADIUS_M, IMPLAUSIBLE_KN, STOP_SPEED_KN } from "@/config/constants";
import { dwellsSameIsland } from "@/lib/analytics/same-island";
import { passagesFromDataset } from "@/lib/analytics/passages";
import { distanceM, impliedKnots } from "@/lib/geo/distance";
import { locateIsland } from "@/lib/geo/point-in-polygon";
import type { ActivityArea, Dwell, HarbourPoint, Journey, LandPolygon, VesselDataset } from "@/types/maritime";

/** Grid label for a GPS cluster. The wording is deliberate: this is not a harbour. */
export function activityAreaAt(lat: number, lon: number): { id: string; label: string; lat: number; lon: number } {
  const fx = Math.floor(lon / AREA_CELL_DEG);
  const fy = Math.floor(lat / AREA_CELL_DEG);
  const centerLat = (fy + 0.5) * AREA_CELL_DEG;
  const centerLon = (fx + 0.5) * AREA_CELL_DEG;
  return {
    id: `${fy}:${fx}`,
    label: `Inferred area ${centerLat.toFixed(2)}°N, ${centerLon.toFixed(2)}°E`,
    lat: centerLat,
    lon: centerLon,
  };
}

function dwellFrom(dataset: VesselDataset, indexes: number[], polygons: readonly LandPolygon[]): Dwell | null {
  if (indexes.length < 2) return null;
  const first = indexes[0];
  const last = indexes[indexes.length - 1];
  const startMs = dataset.timeMs[first];
  const endMs = dataset.timeMs[last];
  if (endMs - startMs < DWELL_MIN_MS) return null;
  let lat = 0;
  let lon = 0;
  for (const index of indexes) {
    lat += dataset.lat[index];
    lon += dataset.lon[index];
  }
  lat /= indexes.length;
  lon /= indexes.length;
  const island = locateIsland(polygons, lon, lat);
  const area = activityAreaAt(lat, lon);
  return {
    device: dataset.deviceIndex[first],
    startMs,
    endMs,
    lat,
    lon,
    pingCount: indexes.length,
    islandId: island?.id ?? null,
    islandName: island?.name ?? null,
    areaId: area.id,
    areaLabel: area.label,
    areaLat: area.lat,
    areaLon: area.lon,
    atoll: null,
    confidence: "inferred",
    placeName: null,
    placeSourceId: null,
  };
}

/** Inferred stops. These do not change the original hub grid. */
export function inferDwells(dataset: VesselDataset, polygons: readonly LandPolygon[]): Dwell[] {
  const dwells: Dwell[] = [];
  for (const track of dataset.tracks) {
    let run: number[] = [];
    const flush = () => {
      const dwell = dwellFrom(dataset, run, polygons);
      if (dwell) dwells.push(dwell);
      run = [];
    };
    for (const index of track) {
      if (dataset.speed[index] >= STOP_SPEED_KN) {
        flush();
        continue;
      }
      if (run.length === 0) {
        run.push(index);
        continue;
      }
      const previous = run[run.length - 1];
      const gap = dataset.timeMs[index] - dataset.timeMs[previous];
      const drift = distanceM(dataset.lon[previous], dataset.lat[previous], dataset.lon[index], dataset.lat[index]);
      const fromStart = distanceM(dataset.lon[run[0]], dataset.lat[run[0]], dataset.lon[index], dataset.lat[index]);
      if (gap > DWELL_MAX_GAP_MS || drift > DWELL_RADIUS_M || fromStart > DWELL_RADIUS_M) {
        flush();
        run.push(index);
      } else {
        run.push(index);
      }
    }
    flush();
  }
  return dwells;
}

export function summarizeAreas(dwells: readonly Dwell[]): ActivityArea[] {
  const groups = new Map<string, ActivityArea>();
  for (const dwell of dwells) {
    const existing = groups.get(dwell.areaId);
    if (existing) existing.dwellCount += 1;
    else groups.set(dwell.areaId, { id: dwell.areaId, label: dwell.areaLabel, lat: dwell.areaLat, lon: dwell.areaLon, dwellCount: 1 });
  }
  return [...groups.values()].sort((a, b) => b.dwellCount - a.dwellCount || a.label.localeCompare(b.label));
}

export function journeysFromDwells(dwells: readonly Dwell[]): Journey[] {
  const byDevice = new Map<number, Dwell[]>();
  for (const dwell of dwells) {
    const list = byDevice.get(dwell.device);
    if (list) list.push(dwell);
    else byDevice.set(dwell.device, [dwell]);
  }
  const journeys: Journey[] = [];
  for (const [device, stops] of byDevice) {
    stops.sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < stops.length; i++) {
      const origin = stops[i - 1];
      const destination = stops[i];
      const durationMs = destination.startMs - origin.endMs;
      const straightLineM = distanceM(origin.lon, origin.lat, destination.lon, destination.lat);
      const impliedKn = impliedKnots(straightLineM, durationMs);
      const coverageGap = !(durationMs > 0) || impliedKn > IMPLAUSIBLE_KN;
      const sameIsland = origin.areaId !== destination.areaId && dwellsSameIsland(origin, destination);
      const flags = [
        ...(durationMs > 0 ? [] : ["clock_static" as const]),
        ...(impliedKn > IMPLAUSIBLE_KN ? ["implausible_speed" as const] : []),
        ...(origin.areaId === destination.areaId ? ["same_area" as const] : []),
        ...(sameIsland ? ["same_island" as const] : []),
      ];
      journeys.push({
        device,
        origin,
        destination,
        durationMs,
        straightLineM,
        pathM: straightLineM,
        pingsBetween: 0,
        maxGapMs: Math.max(durationMs, 0),
        impliedKn,
        flags,
        coverageGap,
        credible: !coverageGap && origin.areaId !== destination.areaId && !sameIsland,
      });
    }
  }
  return journeys;
}

export function inferJourneys(
  dataset: VesselDataset,
  polygons: readonly LandPolygon[],
  harbours: readonly HarbourPoint[] = [],
): Journey[] {
  return passagesFromDataset(dataset, polygons, harbours);
}
