export interface CorpusQuality {
  status: "ready" | "pending";
  generatedAt?: string | null;
  fileCount?: number;
  bytes?: number;
  rowsKept?: number;
  rowsDuplicate?: number;
  rowsOutOfBox?: number;
  rowsBadTime?: number;
  devices?: number;
  zeroDurationMoves?: number;
  implausibleJumps?: number;
  identicalConsecutive?: number;
  medianIntervalSec?: number | null;
  medianLagSec?: number | null;
  minuteQuantizedShare?: number | null;
  medianMovingKn?: number | null;
  maxSpeed?: number | null;
  headingVaries?: boolean | null;
  network?: { dhiraagu: number; ooredoo: number; other: number; missing: number };
  parseMs?: number | null;
  rowsPerSecond?: number | null;
  t0?: string | null;
  t1?: string | null;
  speedBuckets?: { label: string; count: number }[];
  intervalBuckets?: { label: string; count: number }[];
  notes?: string[];
}

export async function loadCorpusQuality(): Promise<CorpusQuality | null> {
  try {
    const loaded = await import("@/data/followme-quality.json");
    return loaded.default as CorpusQuality;
  } catch {
    return null;
  }
}
