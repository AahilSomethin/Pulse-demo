import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseGeoJson } from "../../src/lib/parsing/geojson";
import { indicatorsFromMonth, parseStoredMonth, type StoredMonth } from "../../src/lib/analytics/month";
import { findOpportunities } from "../../src/lib/analytics/opportunities";
import { passagesPerObservedDay, type ConnectionIndicator } from "../../src/lib/analytics/connectivity";
import { formatCount, formatDuration, formatKm } from "../../src/lib/format";
import type { GeoConfidence } from "../../src/types/maritime";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, "video-output");

interface NameRecord {
  nameEn: string | null;
  nameDv: string | null;
}

interface PlaceCard {
  title: string;
  localName: string | null;
  cell: string | null;
  confidence: string;
  sourceId: string | null;
  lat: number;
  lon: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function latin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[\u0780-\u07BF]/.test(trimmed) || !/[A-Za-z]/.test(trimmed)) return null;
  return trimmed;
}

function thaana(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !/[\u0780-\u07BF]/.test(trimmed)) return null;
  return trimmed;
}

async function islandNames(): Promise<Map<string, NameRecord>> {
  const text = await readFile(join(root, "public/reference/osm-islands.geojson"), "utf8");
  const names = new Map<string, NameRecord>();
  for (const polygon of parseGeoJson(text).polygons) {
    names.set(polygon.id, {
      nameEn: latin(polygon.name),
      nameDv: thaana(polygon.nameDv),
    });
  }
  return names;
}

function splitLabel(label: string): { head: string; cell: string | null } {
  const parts = label.split(" · ");
  if (parts.length < 2) return { head: label.trim(), cell: null };
  return { head: parts[0].trim(), cell: parts.slice(1).join(" · ").trim() };
}

function confidenceLabel(confidence: GeoConfidence): string {
  if (confidence === "near_harbour") return "Near a harbour reference point";
  if (confidence === "named_polygon") return "Named place";
  return "Inferred activity area";
}

function presentPlace(endpoint: ConnectionIndicator["origin"], names: Map<string, NameRecord>): PlaceCard {
  const { head, cell } = splitLabel(endpoint.label);
  const headIsCell = head.startsWith("Inferred area");
  const matched = endpoint.sourceId ? names.get(endpoint.sourceId) : undefined;
  const headLatin = latin(head);
  const headThaana = thaana(head);
  const coordinate = endpoint.label.match(/\d+(?:\.\d+)?°[NS], \d+(?:\.\d+)?°[EW]/)?.[0] ?? null;
  const english = headIsCell ? null : headLatin ?? matched?.nameEn ?? null;
  const title = english ?? (headIsCell ? coordinate ?? "Activity cell" : head);
  const localName = headThaana && title !== head ? head : !headThaana && matched?.nameDv && matched.nameDv !== title ? matched.nameDv : null;
  return {
    title,
    localName,
    cell: cell ?? (headIsCell ? head : null),
    confidence: confidenceLabel(endpoint.confidence),
    sourceId: endpoint.sourceId,
    lat: endpoint.lat,
    lon: endpoint.lon,
  };
}

function evidenceLabel(level: ConnectionIndicator["evidence"]): string {
  if (level === "adequate") return "Enough journeys to compare";
  if (level === "limited") return "Limited evidence";
  return "Small sample";
}

function presentStats(indicator: ConnectionIndicator) {
  const perDay = passagesPerObservedDay(indicator);
  return {
    journeys: formatCount(indicator.passages),
    journeysRaw: indicator.passages,
    vessels: formatCount(indicator.vessels),
    vesselsRaw: indicator.vessels,
    perDay: perDay == null ? null : perDay.toFixed(1),
    typical: indicator.medianDurationMs == null ? "—" : formatDuration(indicator.medianDurationMs),
    middleHalf: indicator.iqrMs == null ? "Needs more journeys" : formatDuration(indicator.iqrMs),
    longer: indicator.p90Ms == null ? "Needs more journeys" : formatDuration(indicator.p90Ms),
    separation: indicator.medianDistanceM == null ? "—" : formatKm(indicator.medianDistanceM),
    separationM: indicator.medianDistanceM,
    path: indicator.medianPathRatio == null ? "—" : `${indicator.medianPathRatio.toFixed(1)}×`,
    excluded: formatCount(indicator.excluded),
    excludedRaw: indicator.excluded,
    evidence: evidenceLabel(indicator.evidence),
    activeDays: indicator.activeDays,
    observationDays: indicator.observationDays,
    credibleVesselsSeparated: indicator.credibleVessels != null,
  };
}

function inMaldives(lat: number, lon: number): boolean {
  return lat >= -1 && lat <= 8 && lon >= 72 && lon <= 75;
}

function gapShare(indicator: ConnectionIndicator): number {
  const attempts = indicator.passages + indicator.excluded;
  return attempts === 0 ? 1 : indicator.excluded / attempts;
}

async function main() {
  const monthPath = join(root, "data/derived/connectivity-august-2025.json");
  const qualityPath = join(root, "src/data/followme-quality.json");
  const file: StoredMonth = parseStoredMonth(JSON.parse(await readFile(monthPath, "utf8")));
  const quality: unknown = JSON.parse(await readFile(qualityPath, "utf8"));
  if (!isRecord(quality) || quality.rowsKept !== file.rowsKept || quality.devices !== file.devices) {
    throw new Error("August quality counts do not match the connectivity summary. Refusing to put a headline number on screen.");
  }

  const names = await islandNames();
  const indicators = indicatorsFromMonth(file);
  const { flagged, withheld } = findOpportunities(indicators);
  const ranked = [...flagged].sort((a, b) => b.indicator.passages - a.indicator.passages || a.indicator.id.localeCompare(b.indicator.id));
  const chosen = ranked[0];
  if (!chosen || chosen.indicator.passages < 30) {
    throw new Error("No flagged connection has a large enough sample to show as a finding.");
  }
  const reverse = indicators.find((item) => item.origin.id === chosen.indicator.destination.id && item.destination.id === chosen.indicator.origin.id);
  if (!reverse) throw new Error("The flagged connection has no opposite direction in the August summary.");

  const steady = indicators.find((item) => {
    if (item.id === chosen.indicator.id || item.id === reverse.id) return false;
    if (item.evidence !== "adequate") return false;
    if (gapShare(item) >= 0.1) return false;
    if (item.medianPathRatio == null || item.medianPathRatio >= 1.2) return false;
    if (item.medianDistanceM == null || item.medianDistanceM < 20_000) return false;
    return true;
  });
  if (!steady) throw new Error("No steady repeated connection cleared the scene 3 filters.");

  for (const item of [chosen.indicator, reverse, steady]) {
    if (!inMaldives(item.origin.lat, item.origin.lon) || !inMaldives(item.destination.lat, item.destination.lon)) {
      throw new Error("A selected endpoint is outside the Maldives box.");
    }
  }
  if ((chosen.indicator.medianDistanceM ?? 0) > 30_000 || (reverse.medianDistanceM ?? 0) > 30_000) {
    throw new Error("The finding is not a short crossing. The scene 4 camera would be misleading.");
  }

  const cells = new Map<string, { lat: number; lon: number; passages: number }>();
  for (const item of indicators) {
    for (const end of [item.origin, item.destination]) {
      const current = cells.get(end.id);
      if (current) current.passages += item.passages;
      else cells.set(end.id, { lat: end.lat, lon: end.lon, passages: item.passages });
    }
  }
  const busiestCells = [...cells.values()]
    .filter((cell) => inMaldives(cell.lat, cell.lon))
    .sort((a, b) => b.passages - a.passages)
    .slice(0, 120);

  const flaggedStats = presentStats(chosen.indicator);
  const otherStats = presentStats(reverse);
  const steadyStats = presentStats(steady);
  const flaggedOrigin = presentPlace(chosen.indicator.origin, names);
  const flaggedDestination = presentPlace(chosen.indicator.destination, names);
  const oppositeOrigin = presentPlace(reverse.origin, names);
  const oppositeDestination = presentPlace(reverse.destination, names);
  const labelNote = oppositeDestination.title !== flaggedOrigin.title
    ? `The return record labels ${flaggedOrigin.title} as ${oppositeDestination.title}, ${oppositeDestination.confidence.toLowerCase()}.`
    : null;
  const story = {
    distribution: "internal-review",
    banner: "Internal review · derived locations are not cleared for public redistribution",
    periodLabel: file.periodLabel,
    generatedAt: file.generatedAt,
    observations: formatCount(file.rowsKept),
    observationsRaw: file.rowsKept,
    devices: formatCount(file.devices),
    devicesRaw: file.devices,
    observationDays: file.days.length,
    directions: formatCount(indicators.length),
    directionsRaw: indicators.length,
    flagged: formatCount(flagged.length),
    flaggedRaw: flagged.length,
    withheld: formatCount(withheld.length),
    withheldRaw: withheld.length,
    minVessels: file.minVessels,
    cells: busiestCells,
    steady: {
      origin: presentPlace(steady.origin, names),
      destination: presentPlace(steady.destination, names),
      stats: steadyStats,
    },
    finding: {
      ends: { a: flaggedOrigin, b: flaggedDestination },
      flagged: {
        origin: flaggedOrigin,
        destination: flaggedDestination,
        stats: flaggedStats,
      },
      opposite: {
        origin: oppositeOrigin,
        destination: oppositeDestination,
        stats: otherStats,
      },
      labelNote,
      rules: chosen.rules.map((rule) => ({ id: rule.id, title: rule.title, question: rule.question })),
      caveat: chosen.caveats[0] ?? "A flag is a reason to look.",
      fleetCaveat: "Tracked devices are not the whole fleet.",
    },
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "story.json"), JSON.stringify(story));
  const line = (place: PlaceCard) => [place.title, place.localName, place.cell, place.confidence, place.sourceId].filter(Boolean).join(" | ");
  const summary = [
    `period=${file.periodLabel} observations=${story.observations} devices=${story.devices} days=${story.observationDays} qualityMatch=true`,
    `directions=${story.directions} flagged=${story.flagged} withheld=${story.withheld} minVessels=${file.minVessels} cellsDrawn=${busiestCells.length}`,
    `steady ${line(story.steady.origin)} -> ${line(story.steady.destination)} journeys=${steadyStats.journeys} vessels=${steadyStats.vessels} typical=${steadyStats.typical} longer=${steadyStats.longer} separation=${steadyStats.separation} path=${steadyStats.path} excluded=${steadyStats.excluded} evidence=${steadyStats.evidence}`,
    `flagged ${line(story.finding.flagged.origin)} -> ${line(story.finding.flagged.destination)} journeys=${flaggedStats.journeys} vessels=${flaggedStats.vessels} typical=${flaggedStats.typical} middle=${flaggedStats.middleHalf} longer=${flaggedStats.longer} separation=${flaggedStats.separation} path=${flaggedStats.path} excluded=${flaggedStats.excluded} perDay=${flaggedStats.perDay} evidence=${flaggedStats.evidence} rules=${chosen.rules.map((rule) => rule.id).join(",")}`,
    `opposite ${line(story.finding.opposite.origin)} -> ${line(story.finding.opposite.destination)} journeys=${otherStats.journeys} vessels=${otherStats.vessels} typical=${otherStats.typical} middle=${otherStats.middleHalf} longer=${otherStats.longer} separation=${otherStats.separation} path=${otherStats.path} excluded=${otherStats.excluded}`,
  ];
  await writeFile(join(outDir, "story-summary.txt"), summary.join("\n") + "\n");
  console.log(summary.join("\n"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
