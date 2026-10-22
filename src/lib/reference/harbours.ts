import type { HarbourPoint } from "@/types/maritime";

interface GeoJson {
  type?: string;
  features?: GeoJson[];
  geometry?: GeoJson;
  coordinates?: unknown;
  properties?: Record<string, unknown> | null;
  id?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Point features only. Names and source ids are kept. Missing names stay null. */
export function parseHarbourGeoJson(text: string): HarbourPoint[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Not valid GeoJSON.");
  }
  const root = asRecord(parsed) as GeoJson;
  const features = Array.isArray(root.features) ? root.features : [root];
  const harbours: HarbourPoint[] = [];
  features.forEach((feature, index) => {
    const record = asRecord(feature) as GeoJson;
    const geometry = (record.geometry ?? record) as GeoJson;
    if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return;
    const [lon, lat] = geometry.coordinates as number[];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const properties = asRecord(record.properties);
    const nameRaw = properties.name ?? properties.NAME;
    const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
    const sourceRaw = properties["@id"] ?? properties.id ?? record.id;
    harbours.push({
      id: `harbour-${index}`,
      name,
      lat,
      lon,
      sourceId: sourceRaw == null ? null : String(sourceRaw),
    });
  });
  return harbours;
}
