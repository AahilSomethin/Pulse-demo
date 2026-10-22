/**
 * Downloads OpenStreetMap island polygons and harbour or jetty points for the
 * Maldives. Data is © OpenStreetMap contributors, ODbL. No API key.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

async function run(statement) {
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
        return await response.json();
      } catch (error) {
        last = error instanceof Error ? error.message : "request failed";
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }
  throw new Error(last);
}

function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}

const directory = path.resolve("public/reference");
await mkdir(directory, { recursive: true });

let islands = null;
let harbourNodes = null;
try {
  islands = await run(query);
  harbourNodes = await run(harbourQuery);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("Reference download failed. SeaPulse will keep using inferred activity areas.");
  process.exitCode = 1;
}

if (islands && harbourNodes) {
  const islandFeatures = [];
  for (const element of asRecord(islands).elements ?? []) {
    const item = asRecord(element);
    const tags = asRecord(item.tags);
    const geometry = Array.isArray(item.geometry) ? item.geometry : null;
    if (!geometry || typeof tags.name !== "string") continue;
    const ring = geometry
      .map((point) => {
        const pair = asRecord(point);
        return [Number(pair.lon), Number(pair.lat)];
      })
      .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
    if (ring.length < 4) continue;
    islandFeatures.push({
      type: "Feature",
      properties: {
        name: tags.name,
        atoll: typeof tags["addr:district"] === "string" ? tags["addr:district"] : typeof tags.is_in === "string" ? tags.is_in : null,
        sourceId: `${item.type}/${item.id}`,
        source: "OpenStreetMap",
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  const harbourFeatures = [];
  for (const element of asRecord(harbourNodes).elements ?? []) {
    const item = asRecord(element);
    if (!Number.isFinite(Number(item.lon)) || !Number.isFinite(Number(item.lat))) continue;
    const tags = asRecord(item.tags);
    harbourFeatures.push({
      type: "Feature",
      properties: {
        name: typeof tags.name === "string" ? tags.name : null,
        "@id": `${item.type}/${item.id}`,
        source: "OpenStreetMap",
      },
      geometry: { type: "Point", coordinates: [Number(item.lon), Number(item.lat)] },
    });
  }
  if (islandFeatures.length === 0 && harbourFeatures.length === 0) {
    console.error("Overpass returned no usable features. Inferred areas remain the fallback.");
    process.exitCode = 1;
  } else {
    await writeFile(path.join(directory, "osm-islands.geojson"), `${JSON.stringify({ type: "FeatureCollection", features: islandFeatures })}\n`);
    await writeFile(path.join(directory, "osm-harbours.geojson"), `${JSON.stringify({ type: "FeatureCollection", features: harbourFeatures })}\n`);
    await writeFile(path.join(directory, "sources.json"), `${JSON.stringify({
      source: "OpenStreetMap",
      licence: "Open Database License (ODbL) 1.0",
      attribution: "© OpenStreetMap contributors",
      retrievedAt: new Date().toISOString(),
      area: "Maldives relation 536773",
      islands: islandFeatures.length,
      harbours: harbourFeatures.length,
      notes: [
        "Island polygons are place=island or place=islet features that have a name and a geometry.",
        "Harbour points are named harbour nodes, ferry terminals, and named piers.",
        "A match is a geographic hint. It is not confirmation of a port call.",
      ],
    }, null, 2)}\n`);
    console.log(`islands=${islandFeatures.length} harbours=${harbourFeatures.length}`);
  }
}
