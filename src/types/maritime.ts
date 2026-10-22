export type HubMode = "stop" | "move" | "all";

export interface DatasetQuality {
  duplicateRows: number;
  zeroDurationMoves: number;
  implausibleJumps: number;
  identicalConsecutive: number;
  /** Share of kept rows whose device_date is on a whole minute. Null when the column is absent. */
  minuteQuantizedShare: number | null;
  medianLagSec: number | null;
  medianIntervalSec: number | null;
  /** Median reported speed among pings at or above the stop threshold. Unit is unverified. */
  medianMovingKn: number | null;
  maxSpeed: number;
  headingVaries: boolean;
  network: { dhiraagu: number; ooredoo: number; other: number; missing: number };
  gsmKnown: number;
}

export interface VesselDataset {
  timeMs: Float64Array;
  /** Database save time. Equals timeMs when the file has no timestamp column. */
  savedMs: Float64Array;
  lat: Float32Array;
  lon: Float32Array;
  speed: Float32Array;
  /** Degrees, or -1 when the column is absent. */
  heading: Int16Array;
  /** 1 Dhiraagu, 2 Ooredoo, 0 other, -1 missing. */
  network: Int8Array;
  /** Signal level, or -1 when missing. */
  gsm: Int16Array;
  deviceIndex: Int32Array;
  names: string[];
  /** Point indexes per device, in time order. */
  tracks: number[][];
  t0: number;
  t1: number;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  rejected: { blank: number; outOfBox: number; badTime: number; duplicate: number };
  kept: number;
  sourceLabel: string;
  /** True only for the bundled test file. Never treat as real findings. */
  synthetic: boolean;
  /** "August 2025" when the file falls in that month. Empty otherwise. */
  periodLabel: string;
  quality: DatasetQuality;
}

export interface HubCell {
  fx: number;
  fy: number;
  devices: number;
  centerLat: number;
  centerLon: number;
  alpha: number;
}

export interface VesselPosition {
  device: number;
  index: number;
}

export interface ActivityFrame {
  cursorMs: number;
  windowMs: number;
  pingCount: number;
  positions: VesselPosition[];
  hubs: HubCell[];
  topHubs: HubCell[];
}

export interface LandPolygon {
  id: string;
  name: string | null;
  /** Dhivehi name when the reference file has one. Display uses `name`. */
  nameDv?: string | null;
  /** Atoll name from the reference file, when that property exists. */
  atoll: string | null;
  rings: number[][][];
  synthetic: boolean;
}

export interface HarbourPoint {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  sourceId: string | null;
}

export type FacilityKind = "medical" | "coast_guard";

export interface Facility {
  id: string;
  name: string;
  kind: FacilityKind;
  /** True only when the source explicitly marks the feature verified. */
  verified: boolean;
  lat: number;
  lon: number;
  synthetic: boolean;
}

export interface ParsedGeography {
  polygons: LandPolygon[];
  facilities: Facility[];
  landFeatureCount: number;
}

export interface Dwell {
  device: number;
  startMs: number;
  endMs: number;
  lat: number;
  lon: number;
  pingCount: number;
  islandId: string | null;
  islandName: string | null;
  /** Grid cluster of the dwell. This is not a harbour or a verified island. */
  areaId: string;
  areaLabel: string;
  areaLat: number;
  areaLon: number;
  /** Atoll from a matched named polygon, when the reference file has one. */
  atoll: string | null;
  confidence: GeoConfidence;
  /** Harbour name when the stop is near a harbour and not inside a named polygon. */
  placeName: string | null;
  placeSourceId: string | null;
}

export type PassageFlag = "clock_static" | "implausible_speed" | "sparse_tracking" | "same_area";

export type GeoConfidence = "inferred" | "named_polygon" | "near_harbour";

export interface Journey {
  device: number;
  origin: Dwell;
  destination: Dwell;
  durationMs: number;
  straightLineM: number;
  /** Sum of ping-to-ping distances between the two dwells. */
  pathM: number;
  pingsBetween: number;
  /** Largest gap between consecutive reports on this passage, including the endpoints. */
  maxGapMs: number;
  impliedKn: number;
  flags: PassageFlag[];
  /** Straight-line speed is not a credible passage. Sparse and same-area stays are separate flags. */
  coverageGap: boolean;
  /** Usable in duration statistics. Flagged passages are kept on the journey and excluded here. */
  credible: boolean;
}

export interface IslandLink {
  origin: string;
  destination: string;
  tripCount: number;
  medianDurationMs: number;
  medianDistanceM: number;
  shortestDurationMs: number;
  longestDurationMs: number;
  placeKind: "named_island";
}

/** GPS-cluster link. Never a confirmed terminal, harbour, or island. */
export interface AreaLink {
  originId: string;
  destinationId: string;
  origin: string;
  destination: string;
  originLat: number;
  originLon: number;
  destinationLat: number;
  destinationLon: number;
  tripCount: number;
  medianDurationMs: number;
  medianDistanceM: number;
  shortestDurationMs: number;
  longestDurationMs: number;
  placeKind: "inferred_activity";
}

export interface ActivityArea {
  id: string;
  label: string;
  lat: number;
  lon: number;
  dwellCount: number;
}

export interface ResponseOption {
  id: string;
  label: string;
  evidence: "observed_position" | "verified_coast_guard" | "hypothetical_coast_guard" | "unverified_coast_guard";
  distanceM: number;
  assumedSpeedKn: number;
  etaMin: number | null;
  speedSource: "reported_ping" | "assumed";
  reportedSpeedKn: number | null;
  medicalName: string | null;
  medicalLegMin: number | null;
  combinedMin: number | null;
  note: string;
}
