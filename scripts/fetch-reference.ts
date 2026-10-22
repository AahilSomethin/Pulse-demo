/**
 * Downloads OpenStreetMap island polygons, atoll boundaries, and harbour points
 * for the Maldives. Data is © OpenStreetMap contributors, ODbL. No API key.
 * An existing reference file is left in place when the download fails.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { polygonContains } from "../src/lib/geo/point-in-polygon";
import { canonicalAtoll, type AtollCode } from "../src/lib/reference/atolls";

const mirrors = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const query = `
[out:json][timeout:180];
area(3600536773)->.mv;
(
  nwr["place"~"^(island|islet)$"]["name"](area.mv);
);
out geom;
`.trim();

const atollQuery = `
[out:json][timeout:180];
area(3600536773)->.mv;
rel["boundary"="administrative"]["admin_level"="4"](area.mv)->.atolls;
(.atolls; way(r.atolls););
out geom;
`.trim();

const harbourQuery = `
[out:json][timeout:180];
area(3600536773)->.mv;
(
  node["harbour"]["name"](area.mv);
  node["amenity"="ferry_terminal"](area.mv);
  node["man_made"="pier"]["name"](area.mv);
);
out body;
`.trim();

interface OverpassPoint {
  lon?: number;
  lat?: number;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lon?: number;
  lat?: number;
  tags?: Record<string, string>;
  geometry?: OverpassPoint[];
  members?: { type?: string; ref?: number; role?: string; geometry?: OverpassPoint[] }[];
}

async function run(statement: string): Promise<{ elements?: OverpassElement[] }> {
  let last = "no response";
  for (const mirror of mirrors) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(mirror, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "SeaPulse-datathon/0.1" },
          body: new URLSearchParams({ data: statement }),
          signal: AbortSignal.timeout(200_000),
        });
        if (!response.ok) {
          last = `${mirror} ${response.status}`;
          await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
          continue;
        }
        return await response.json() as { elements?: OverpassElement[] };
      } catch (error) {
        last = error instanceof Error ? error.message : "request failed";
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }
  throw new Error(last);
}

function ringFrom(points: OverpassPoint[] | undefined): number[][] {
  return (points ?? [])
    .map((point) => [Number(point.lon), Number(point.lat)])
    .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
}

function elementRings(element: OverpassElement): number[][][] {
  const direct = ringFrom(element.geometry);
  if (direct.length >= 4) return [direct];
  const outers = (element.members ?? [])
    .filter((member) => member.role === "outer" || !member.role)
    .map((member) => ringFrom(member.geometry))
    .filter((ring) => ring.length >= 4);
  return outers;
}

function centroid(ring: number[][]): { lon: number; lat: number } | null {
  if (ring.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const pair of ring) {
    lon += pair[0];
    lat += pair[1];
  }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

function latinName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /[\u0780-\u07BF]/.test(trimmed) || !/[A-Za-z]/.test(trimmed)) return null;
  return trimmed;
}

function boundaryRings(elements: OverpassElement[]): { code: AtollCode; rings: number[][][] }[] {
  const ways = new Map<number, number[][]>();
  for (const element of elements) {
    if (element.type !== "way" || element.id == null) continue;
    const ring = ringFrom(element.geometry);
    if (ring.length >= 4) ways.set(element.id, ring);
  }
  const boundaries: { code: AtollCode; rings: number[][][] }[] = [];
  const skipped: string[] = [];
  for (const element of elements) {
    if (element.type !== "relation") continue;
    const label = element.tags?.["name:en"] || element.tags?.name || "unnamed";
    const code = canonicalAtoll(label);
    let rings = elementRings(element);
    if (rings.length === 0) {
      rings = (element.members ?? [])
        .filter((member) => member.type === "way" && member.ref != null && (member.role === "outer" || !member.role))
        .map((member) => ways.get(member.ref as number))
        .filter((ring): ring is number[][] => ring != null && ring.length >= 4);
    }
    if (code && rings.length > 0) boundaries.push({ code, rings });
    else skipped.push(`${label} (code ${code ?? "none"}, rings ${rings.length})`);
  }
  if (skipped.length > 0) console.log(`skipped atoll boundaries: ${skipped.join("; ")}`);
  return boundaries;
}

function atollFor(element: OverpassElement, boundaries: { code: AtollCode; rings: number[][][] }[]): AtollCode | null {
  const tags = element.tags ?? {};
  const tagged = canonicalAtoll(tags["addr:atoll"] || tags["is_in:atoll"] || tags.atoll || tags.is_in);
  if (tagged) return tagged;
  const center = centroid(elementRings(element)[0] ?? []);
  if (!center) return null;
  for (const boundary of boundaries) {
    if (boundary.rings.some((ring) => polygonContains([ring], center.lon, center.lat))) return boundary.code;
  }
  return null;
}

async function assignAtollsOnly(directory: string) {
  const atolls = await run(atollQuery);
  const boundaries = boundaryRings(atolls.elements ?? []);
  const filePath = path.join(directory, "osm-islands.geojson");
  const collection = JSON.parse(await readFile(filePath, "utf8")) as {
    features: { properties: Record<string, unknown>; geometry: { type?: string; coordinates?: number[][][] | number[][][][] } }[];
  };
  let withAtoll = 0;
  for (const feature of collection.features) {
    const coordinates = feature.geometry.coordinates;
    const ring = feature.geometry.type === "MultiPolygon"
      ? (coordinates as number[][][][] | undefined)?.[0]?.[0]
      : (coordinates as number[][][] | undefined)?.[0];
    const center = centroid(ring ?? []);
    let code: AtollCode | null = null;
    if (center) {
      for (const boundary of boundaries) {
        if (boundary.rings.some((item) => polygonContains([item], center.lon, center.lat))) {
          code = boundary.code;
          break;
        }
      }
    }
    feature.properties.atoll = code;
    if (code) withAtoll += 1;
  }
  await writeFile(filePath, `${JSON.stringify(collection)}\n`);
  console.log(`atoll-only boundaries=${boundaries.length} islandsWithAtoll=${withAtoll}`);
}

async function main() {
const directory = path.resolve("public/reference");
await mkdir(directory, { recursive: true });
if (process.argv.includes("--atolls-only")) {
  try {
    await assignAtollsOnly(directory);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error("Atoll assignment failed. The existing island file was left unchanged.");
    process.exitCode = 1;
  }
  return;
}

let islands: { elements?: OverpassElement[] } | null = null;
let harbourNodes: { elements?: OverpassElement[] } | null = null;
let atollRelations: { elements?: OverpassElement[] } | null = null;
try {
  islands = await run(query);
  harbourNodes = await run(harbourQuery);
  atollRelations = await run(atollQuery);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("Reference download failed. Existing files, if any, were left unchanged.");
  process.exitCode = 1;
}

if (islands && harbourNodes) {
  const boundaries = boundaryRings(atollRelations?.elements ?? []);

  const islandFeatures = [];
  for (const element of islands.elements ?? []) {
    const tags = element.tags ?? {};
    if (tags.place !== "island" && tags.place !== "islet") continue;
    const rings = elementRings(element);
    const name = typeof tags.name === "string" ? tags.name.trim() : "";
    if (!name || rings.length === 0) continue;
    const nameEn = latinName(tags["name:en"]) ?? latinName(name);
    const nameDv = tags["name:dv"]?.trim() || (/[\u0780-\u07BF]/.test(name) ? name : null);
    islandFeatures.push({
      type: "Feature",
      properties: {
        name: nameEn ?? name,
        nameEn,
        nameDv,
        atoll: atollFor(element, boundaries),
        sourceId: `${element.type}/${element.id}`,
        source: "OpenStreetMap",
      },
      geometry: rings.length === 1
        ? { type: "Polygon", coordinates: [rings[0]] }
        : { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) },
    });
  }

  const harbourFeatures = [];
  for (const element of harbourNodes.elements ?? []) {
    if (!Number.isFinite(Number(element.lon)) || !Number.isFinite(Number(element.lat))) continue;
    const tags = element.tags ?? {};
    harbourFeatures.push({
      type: "Feature",
      properties: {
        name: typeof tags.name === "string" ? tags.name : null,
        "@id": `${element.type}/${element.id}`,
        source: "OpenStreetMap",
      },
      geometry: { type: "Point", coordinates: [Number(element.lon), Number(element.lat)] },
    });
  }

  if (islandFeatures.length === 0 && harbourFeatures.length === 0) {
    console.error("Overpass returned no usable features. Existing files were left unchanged.");
    process.exitCode = 1;
  } else {
    const withAtoll = islandFeatures.filter((feature) => feature.properties.atoll).length;
    const withEnglish = islandFeatures.filter((feature) => feature.properties.nameEn).length;
    await writeFile(path.join(directory, "osm-islands.geojson"), `${JSON.stringify({ type: "FeatureCollection", features: islandFeatures })}\n`);
    await writeFile(path.join(directory, "osm-harbours.geojson"), `${JSON.stringify({ type: "FeatureCollection", features: harbourFeatures })}\n`);
    await writeFile(path.join(directory, "sources.json"), `${JSON.stringify({
      source: "OpenStreetMap",
      licence: "Open Database License (ODbL) 1.0",
      attribution: "© OpenStreetMap contributors",
      retrievedAt: new Date().toISOString(),
      area: "Maldives relation 536773",
      islands: islandFeatures.length,
      islandsWithEnglishName: withEnglish,
      islandsWithAtoll: withAtoll,
      atollBoundaries: boundaries.length,
      harbours: harbourFeatures.length,
      notes: [
        "Island polygons are place=island or place=islet features that have a name and a geometry.",
        "nameEn is name:en, or the name tag when it is already in Latin script.",
        "atoll is an official abbreviation from addr:atoll, is_in:atoll, or the admin_level 4 boundary that contains the island.",
        "Harbour points are named harbour nodes, ferry terminals, and named piers.",
        "A match is a geographic hint. It is not confirmation of a port call.",
      ],
    }, null, 2)}\n`);
    console.log(`islands=${islandFeatures.length} english=${withEnglish} atoll=${withAtoll} boundaries=${boundaries.length} harbours=${harbourFeatures.length}`);
  }
}
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
