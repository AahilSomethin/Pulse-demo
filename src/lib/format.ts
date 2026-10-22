import { MVT_OFFSET_MS } from "@/config/constants";
import { metersToNm } from "@/lib/geo/distance";

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

export function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Maldives time is UTC+5 year-round. Display only; calculations stay in UTC. */
export function formatMvt(ms: number): string {
  return `${new Date(ms + MVT_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ")} MVT`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatNm(meters: number): string {
  return `${metersToNm(meters).toFixed(1)} nm`;
}

export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatMinutes(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function maskDevice(id: string): string {
  const compact = id.trim();
  if (compact.length <= 4) return "Device";
  return `Device ••••${compact.slice(-4)}`;
}

export function historicalLabel(periodLabel: string): string {
  return periodLabel === "August 2025" ? "Historical August 2025 observations" : "Historical tracker observations";
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
