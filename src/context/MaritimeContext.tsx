"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DEFAULT_CELL_DEG, DEFAULT_WINDOW_MS } from "@/config/constants";
import { aggregateAreaLinks, aggregateLinks } from "@/lib/analytics/network";
import { buildConnectionIndicators, type ConnectionIndicator } from "@/lib/analytics/connectivity";
import { indicatorsFromMonth, parseStoredMonth, type StoredMonth } from "@/lib/analytics/month";
import { inferDwells, inferJourneys, summarizeAreas } from "@/lib/analytics/journeys";
import { canonicalAtoll } from "@/lib/reference/atolls";
import { joinCensus, type CensusIsland, type CensusJoin, type CensusPlace } from "@/lib/reference/census";
import { parseHarbourGeoJson } from "@/lib/reference/harbours";
import { sortDayFiles } from "@/lib/parsing/days";
import { parseDatasetAsync, parseFileAsync } from "@/lib/parsing/load-csv";
import { parseGeoJson } from "@/lib/parsing/geojson";
import { buildSpeedMask, computeFrame, initialCursor } from "@/lib/vessels/frame";
import { advancePlayback, commitIntervalMs, isPlaybackSpeed, playbackStep, type PlaybackSpeed } from "@/lib/vessels/playback";
import type { ActivityArea, ActivityFrame, AreaLink, HarbourPoint, HubMode, IslandLink, Journey, ParsedGeography, VesselDataset } from "@/types/maritime";

interface DatasetValue {
  dataset: VesselDataset | null;
  geography: ParsedGeography | null;
  journeys: Journey[];
  links: IslandLink[];
  areaLinks: AreaLink[];
  areas: ActivityArea[];
  indicators: ConnectionIndicator[];
  month: StoredMonth | null;
  monthIndicators: ConnectionIndicator[];
  census: CensusJoin | null;
  harbours: HarbourPoint[];
  loading: boolean;
  loadingLabel: string | null;
  error: string | null;
  days: string[];
  activeDay: string | null;
  loadCsvText: (text: string, sourceLabel: string) => Promise<void>;
  loadCsvFile: (file: File) => Promise<void>;
  loadCsvFiles: (files: Iterable<File>) => Promise<void>;
  loadLocalAugust: () => Promise<void>;
  selectDay: (name: string) => Promise<void>;
  loadGeoText: (text: string) => void;
  loadSample: () => Promise<void>;
  loadMonth: () => Promise<void>;
}

interface PlaybackSettings {
  windowMs: number;
  mode: HubMode;
  cellDeg: number;
  threshold: number;
  selected: number;
  playing: boolean;
  speed: PlaybackSpeed;
  setWindowMs: (value: number) => void;
  setMode: (value: HubMode) => void;
  setCellDeg: (value: number) => void;
  setThreshold: (value: number) => void;
  setSelected: (value: number) => void;
  setPlaying: (value: boolean) => void;
  setSpeed: (value: number) => void;
  restart: () => void;
}

interface PlaybackClock {
  cursor: number;
  frame: ActivityFrame | null;
  setCursor: (value: number) => void;
}

const DatasetContext = createContext<DatasetValue | null>(null);
const PlaybackSettingsContext = createContext<PlaybackSettings | null>(null);
const PlaybackClockContext = createContext<PlaybackClock | null>(null);

export function MaritimeProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<VesselDataset | null>(null);
  const [geography, setGeography] = useState<ParsedGeography | null>(null);
  const [harbours, setHarbours] = useState<HarbourPoint[]>([]);
  const [month, setMonth] = useState<StoredMonth | null>(null);
  const [census, setCensus] = useState<CensusJoin | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [windowMs, setWindowMs] = useState(DEFAULT_WINDOW_MS);
  const [mode, setMode] = useState<HubMode>("stop");
  const [cellDeg, setCellDeg] = useState(DEFAULT_CELL_DEG);
  const [threshold, setThreshold] = useState(0);
  const [selected, setSelected] = useState(-1);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const files = useRef(new Map<string, File>());
  const cache = useRef(new Map<string, VesselDataset>());
  const censusRows = useRef<CensusIsland[] | null>(null);
  const geographyRef = useRef<ParsedGeography | null>(null);

  const applyDataset = useCallback((next: VesselDataset) => {
    setDataset(next);
    setSelected(-1);
    setPlaying(false);
    setCursor(initialCursor(next.t0, next.t1, windowMs));
  }, [windowMs]);

  const remember = useCallback((name: string, next: VesselDataset) => {
    cache.current.delete(name);
    cache.current.set(name, next);
    while (cache.current.size > 2) {
      const oldest = cache.current.keys().next().value;
      if (!oldest || oldest === name) break;
      cache.current.delete(oldest);
    }
  }, []);

  const loadCsvText = useCallback(
    async (text: string, sourceLabel: string) => {
      setLoading(true);
      setLoadingLabel(`Indexing ${sourceLabel}…`);
      setError(null);
      try {
        const next = await parseDatasetAsync(text, sourceLabel);
        remember(sourceLabel, next);
        setDays([sourceLabel]);
        setActiveDay(sourceLabel);
        applyDataset(next);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not read that CSV.");
      } finally {
        setLoading(false);
        setLoadingLabel(null);
      }
    },
    [applyDataset, remember],
  );

  const readFile = useCallback(
    async (file: File, keepDays = false) => {
      setLoading(true);
      setLoadingLabel(`Reading ${file.name}…`);
      setError(null);
      try {
        const cached = cache.current.get(file.name);
        const next = cached ?? (await parseFileAsync(file));
        files.current.set(file.name, file);
        remember(file.name, next);
        if (!keepDays) setDays([file.name]);
        setActiveDay(file.name);
        applyDataset(next);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not read that CSV.");
      } finally {
        setLoading(false);
        setLoadingLabel(null);
      }
    },
    [applyDataset, remember],
  );

  const loadCsvFile = useCallback((file: File) => readFile(file, false), [readFile]);

  const loadDevDay = useCallback(
    async (name: string) => {
      const day = Number(name.replace(/\.csv$/i, ""));
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        setError("Choose one of the local August files.");
        return;
      }
      setLoading(true);
      setLoadingLabel(`Reading ${name} from the project data folder…`);
      setError(null);
      try {
        const response = await fetch(`/api/dev-followme/${day}`);
        if (!response.ok) throw new Error("The local August file could not be read.");
        const next = await parseDatasetAsync(await response.text(), name);
        remember(name, next);
        setActiveDay(name);
        applyDataset(next);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not read that day.");
      } finally {
        setLoading(false);
        setLoadingLabel(null);
      }
    },
    [applyDataset, remember],
  );

  const loadLocalAugust = useCallback(async () => {
    files.current.clear();
    cache.current.clear();
    setDays(Array.from({ length: 31 }, (_, index) => `${index + 1}.csv`));
    await loadDevDay("1.csv");
  }, [loadDevDay]);

  const selectDay = useCallback(
    async (name: string) => {
      if (name === activeDay && dataset) return;
      const cached = cache.current.get(name);
      if (cached) {
        setActiveDay(name);
        applyDataset(cached);
        return;
      }
      const file = files.current.get(name);
      if (!file) {
        if (process.env.NODE_ENV === "development") await loadDevDay(name);
        return;
      }
      setLoading(true);
      setLoadingLabel(`Reading ${file.name}…`);
      setError(null);
      try {
        const next = await parseFileAsync(file);
        remember(name, next);
        setActiveDay(name);
        applyDataset(next);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not read that day.");
      } finally {
        setLoading(false);
        setLoadingLabel(null);
      }
    },
    [activeDay, applyDataset, dataset, loadDevDay, remember],
  );

  const loadCsvFiles = useCallback(
    async (list: Iterable<File>) => {
      const csvs = sortDayFiles(list);
      if (csvs.length === 0) {
        setError("That folder has no CSV files.");
        return;
      }
      files.current = new Map(csvs.map((file) => [file.name, file]));
      cache.current.clear();
      setDays(csvs.map((file) => file.name));
      await readFile(csvs[0], true);
    },
    [readFile],
  );

  const applyCensus = useCallback((next: ParsedGeography | null) => {
    const rows = censusRows.current;
    if (!rows) {
      setCensus(null);
      return;
    }
    setCensus(joinCensus(placesFrom(next), rows));
  }, []);

  const loadGeoText = useCallback((text: string) => {
    try {
      const next = parseGeoJson(text);
      setGeography(next);
      applyCensus(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Not valid GeoJSON.");
    }
  }, [applyCensus]);

  const loadMonth = useCallback(async () => {
    setLoading(true);
    setLoadingLabel("Reading the August connectivity summary…");
    setError(null);
    try {
      const response = await fetch("/api/dev-connectivity");
      if (!response.ok) throw new Error("The month summary is not in data/derived. Run npm run data:connectivity.");
      setMonth(parseStoredMonth(await response.json()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read the month summary.");
    } finally {
      setLoading(false);
      setLoadingLabel(null);
    }
  }, []);

  useEffect(() => {
    geographyRef.current = geography;
  }, [geography]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [islands, harbourFile, censusFile] = await Promise.all([
        fetch("/reference/osm-islands.geojson"),
        fetch("/reference/osm-harbours.geojson"),
        fetch("/reference/census-2022.json"),
      ]);
      if (cancelled) return;
      let parsed: ParsedGeography | null = null;
      if (islands.ok) {
        try {
          parsed = parseGeoJson(await islands.text());
        } catch {
          parsed = null;
        }
      }
      if (harbourFile.ok) {
        try {
          setHarbours(parseHarbourGeoJson(await harbourFile.text()));
        } catch {
          setHarbours([]);
        }
      }
      let rows: CensusIsland[] | null = null;
      if (censusFile.ok) {
        try {
          rows = censusIslands(await censusFile.json());
        } catch {
          rows = null;
        }
      }
      if (cancelled) return;
      const geographyForJoin = geographyRef.current ?? parsed;
      if (!geographyRef.current && parsed) setGeography(parsed);
      if (rows) {
        censusRows.current = rows;
        setCensus(joinCensus(placesFrom(geographyForJoin), rows));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSample = useCallback(async () => {
    setLoading(true);
    setLoadingLabel("Loading synthetic test data…");
    setError(null);
    try {
      const [csvResponse, geoResponse] = await Promise.all([
        fetch("/fixtures/synthetic-followme.csv"),
        fetch("/fixtures/synthetic-islands.geojson"),
      ]);
      if (!csvResponse.ok || !geoResponse.ok) throw new Error("The synthetic sample files could not be loaded.");
      const [csvText, geoText] = await Promise.all([csvResponse.text(), geoResponse.text()]);
      const next = await parseDatasetAsync(csvText, "synthetic-followme.csv");
      files.current.clear();
      cache.current.clear();
      setDays(["synthetic-followme.csv"]);
      setActiveDay("synthetic-followme.csv");
      applyDataset(next);
      const sampleGeography = parseGeoJson(geoText);
      setGeography(sampleGeography);
      applyCensus(sampleGeography);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the sample.");
    } finally {
      setLoading(false);
      setLoadingLabel(null);
    }
  }, [applyCensus, applyDataset]);

  const cursorRef = useRef(cursor);
  const speedRef = useRef(speed);
  const windowRef = useRef(windowMs);
  const datasetRef = useRef(dataset);
  useLayoutEffect(() => {
    cursorRef.current = cursor;
    speedRef.current = speed;
    windowRef.current = windowMs;
    datasetRef.current = dataset;
  });

  const setSpeed = useCallback((value: number) => {
    if (isPlaybackSpeed(value)) setSpeedState(value);
  }, []);

  const restart = useCallback(() => {
    const current = datasetRef.current;
    if (!current) return;
    setCursor(initialCursor(current.t0, current.t1, windowRef.current));
  }, []);

  useEffect(() => {
    if (!playing || !dataset) return;
    let raf = 0;
    let last = performance.now();
    let wall = 0;
    let pending = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) {
        last = now;
        return;
      }
      const delta = now - last;
      last = now;
      if (!(delta > 0) || !Number.isFinite(delta)) return;
      wall += delta;
      if (wall < commitIntervalMs(speedRef.current)) return;
      const current = datasetRef.current;
      if (!current) return;
      pending += playbackStep(windowRef.current, speedRef.current, wall);
      wall = 0;
      if (!Number.isFinite(pending) || pending < 0) {
        pending = 0;
        return;
      }
      const result = advancePlayback(cursorRef.current, current.t0, current.t1, pending);
      pending = result.remainder;
      const next = Math.round(result.cursor);
      if (next !== Math.round(cursorRef.current)) {
        cursorRef.current = next;
        setCursor(next);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, dataset]);

  const movement = useMemo(() => {
    if (!dataset) {
      return {
        journeys: [] as Journey[],
        links: [] as IslandLink[],
        areaLinks: [] as AreaLink[],
        areas: [] as ActivityArea[],
        indicators: [] as ConnectionIndicator[],
      };
    }
    const polygons = geography?.polygons ?? [];
    const dwells = inferDwells(dataset, polygons);
    const journeys = inferJourneys(dataset, polygons, harbours);
    const periodLabel = dataset.periodLabel || "Loaded day";
    return {
      journeys,
      links: aggregateLinks(journeys),
      areaLinks: aggregateAreaLinks(journeys),
      areas: summarizeAreas(dwells),
      indicators: buildConnectionIndicators(journeys, { scope: "day", periodLabel, observationDays: 1 }),
    };
  }, [dataset, geography, harbours]);

  const monthIndicators = useMemo(() => (month ? indicatorsFromMonth(month) : []), [month]);

  const mask = useMemo(() => (dataset ? buildSpeedMask(dataset, threshold) : null), [dataset, threshold]);
  const frame = useMemo(() => {
    if (!dataset || !mask) return null;
    return computeFrame(dataset, cursor, windowMs, cellDeg, mode, mask, selected);
  }, [dataset, mask, cursor, windowMs, cellDeg, mode, selected]);

  const dataValue = useMemo<DatasetValue>(
    () => ({
      dataset,
      geography,
      journeys: movement.journeys,
      links: movement.links,
      areaLinks: movement.areaLinks,
      areas: movement.areas,
      indicators: movement.indicators,
      month,
      monthIndicators,
      census,
      harbours,
      loading,
      loadingLabel,
      error,
      days,
      activeDay,
      loadCsvText,
      loadCsvFile,
      loadCsvFiles,
      loadLocalAugust,
      selectDay,
      loadGeoText,
      loadSample,
      loadMonth,
    }),
    [dataset, geography, movement, month, monthIndicators, census, harbours, loading, loadingLabel, error, days, activeDay, loadCsvText, loadCsvFile, loadCsvFiles, loadLocalAugust, selectDay, loadGeoText, loadSample, loadMonth],
  );
  const settingsValue = useMemo<PlaybackSettings>(
    () => ({
      windowMs,
      mode,
      cellDeg,
      threshold,
      selected,
      playing,
      speed,
      setWindowMs,
      setMode,
      setCellDeg,
      setThreshold,
      setSelected,
      setPlaying,
      setSpeed,
      restart,
    }),
    [windowMs, mode, cellDeg, threshold, selected, playing, speed, setSpeed, restart],
  );
  const clockValue = useMemo<PlaybackClock>(
    () => ({ cursor, frame, setCursor }),
    [cursor, frame],
  );

  return (
    <DatasetContext.Provider value={dataValue}>
      <PlaybackSettingsContext.Provider value={settingsValue}>
        <PlaybackClockContext.Provider value={clockValue}>{children}</PlaybackClockContext.Provider>
      </PlaybackSettingsContext.Provider>
    </DatasetContext.Provider>
  );
}

export function useDataset() {
  const value = useContext(DatasetContext);
  if (!value) throw new Error("useDataset must be used within MaritimeProvider");
  return value;
}

export function usePlaybackSettings() {
  const value = useContext(PlaybackSettingsContext);
  if (!value) throw new Error("usePlaybackSettings must be used within MaritimeProvider");
  return value;
}

export function usePlaybackClock() {
  const value = useContext(PlaybackClockContext);
  if (!value) throw new Error("usePlaybackClock must be used within MaritimeProvider");
  return value;
}

/** Settings plus the moving clock. Prefer the split hooks in controls that should not redraw every sample. */
export function usePlayback() {
  return { ...usePlaybackSettings(), ...usePlaybackClock() };
}

function placesFrom(geography: ParsedGeography | null): CensusPlace[] {
  const places: CensusPlace[] = [];
  for (const polygon of geography?.polygons ?? []) {
    if (!polygon.name || polygon.synthetic) continue;
    places.push({ name: polygon.name, atoll: polygon.atoll });
  }
  return places;
}

function censusIslands(payload: unknown): CensusIsland[] {
  if (!payload || typeof payload !== "object" || !("islands" in payload)) return [];
  const islands = (payload as { islands?: unknown }).islands;
  if (!Array.isArray(islands)) return [];
  const rows: CensusIsland[] = [];
  for (const item of islands) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<CensusIsland>;
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    if (typeof row.population !== "number" || !Number.isFinite(row.population)) continue;
    rows.push({
      code: typeof row.code === "string" ? row.code : null,
      name: row.name,
      atoll: canonicalAtoll(typeof row.atoll === "string" ? row.atoll : null),
      population: row.population,
      maldivian: typeof row.maldivian === "number" ? row.maldivian : null,
      foreign: typeof row.foreign === "number" ? row.foreign : null,
      ward: row.ward === true,
    });
  }
  return rows;
}
