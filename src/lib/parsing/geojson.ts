import { canonicalAtoll } from "@/lib/reference/atolls";
import type { Facility, FacilityKind, LandPolygon, ParsedGeography } from "@/types/maritime";

interface GeoJson {
  type?: string;
  features?: GeoJson[];
  geometry?: GeoJson;
  coordinates?: unknown;
  properties?: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function textProperty(properties: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const raw = properties[key];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function hasThaana(value: string): boolean {
  return /[\u0780-\u07BF]/.test(value);
}

function isLatinName(value: string): boolean {
  return /[A-Za-z]/.test(value) && !hasThaana(value);
}

function featureNames(properties: Record<string, unknown>): { name: string | null; nameDv: string | null } {
  const english = textProperty(properties, ["nameEn", "name:en", "name_en"]);
  const dhivehi = textProperty(properties, ["nameDv", "name:dv"]);
  const raw = textProperty(properties, ["name", "NAME", "Name", "island"]);
  const nameEn = english ?? (raw && isLatinName(raw) ? raw : null);
  const nameDv = dhivehi ?? (raw && hasThaana(raw) ? raw : null);
  return { name: nameEn ?? raw, nameDv };
}

function featureAtoll(properties: Record<string, unknown>): string | null {
  const raw = textProperty(properties, ["atoll", "ATOLL", "admin2", "is_in:atoll", "addr:atoll"]);
  return canonicalAtoll(raw) ?? raw;
}

function isVerified(properties: Record<string, unknown>): boolean {
  return properties.verified === true || properties.verified === "true";
}

function isSynthetic(properties: Record<string, unknown>): boolean {
  return properties.synthetic === true || properties.synthetic === "true";
}

function facilityKind(properties: Record<string, unknown>): FacilityKind | null {
  const raw = String(properties.kind ?? properties.type ?? properties.facility ?? "").toLowerCase();
  if (raw === "medical" || raw === "hospital" || raw === "clinic") return "medical";
  if (raw === "coast_guard" || raw === "coastguard" || raw === "coast-guard") return "coast_guard";
  return null;
}

function polygonParts(geometry: GeoJson): number[][][][] {
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates as number[][][]];
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates as number[][][][];
  }
  return [];
}

export function ringCentroid(ring: number[][]): { lon: number; lat: number } | null {
  if (ring.length === 0) return null;
  let lon = 0;
  let lat = 0;
  let count = 0;
  for (const pair of ring) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    lon += pair[0];
    lat += pair[1];
    count += 1;
  }
  if (count === 0) return null;
  return { lon: lon / count, lat: lat / count };
}

/**
 * Land rendering follows the original viewer: Polygon and MultiPolygon only.
 * Points are kept only when they declare a medical or Coast Guard kind.
 */
export function parseGeoJson(text: string): ParsedGeography {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Not valid GeoJSON.");
  }
  const root = asRecord(parsed) as GeoJson;
  const features = Array.isArray(root.features) ? root.features : [root];
  const polygons: LandPolygon[] = [];
  const facilities: Facility[] = [];

  features.forEach((feature, index) => {
    const record = asRecord(feature) as GeoJson;
    const geometry = (record.geometry ?? record) as GeoJson;
    const properties = asRecord(record.properties);
    const kind = facilityKind(properties);
    const { name, nameDv } = featureNames(properties);
    const synthetic = isSynthetic(properties);
    const verified = isVerified(properties);

    if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
      const [lon, lat] = geometry.coordinates as number[];
      if (kind && Number.isFinite(lon) && Number.isFinite(lat)) {
        facilities.push({
          id: `facility-${index}`,
          name: name ?? (kind === "medical" ? "Unnamed medical site" : "Unnamed Coast Guard site"),
          kind,
          verified,
          lat,
          lon,
          synthetic,
        });
      }
      return;
    }

    const parts = polygonParts(geometry);
    if (parts.length === 0) return;
    if (kind) {
      const center = ringCentroid(parts[0]?.[0] ?? []);
      if (center) {
        facilities.push({
          id: `facility-${index}`,
          name: name ?? (kind === "medical" ? "Unnamed medical site" : "Unnamed Coast Guard site"),
          kind,
          verified,
          lat: center.lat,
          lon: center.lon,
          synthetic,
        });
      }
    }
    parts.forEach((rings, part) => {
      polygons.push({ id: `land-${index}-${part}`, name, nameDv, atoll: featureAtoll(properties), rings, synthetic });
    });
  });

  return { polygons, facilities, landFeatureCount: polygons.length };
}
