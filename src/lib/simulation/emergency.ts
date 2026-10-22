import { distanceM, etaMinutes } from "@/lib/geo/distance";
import type { ActivityFrame, Facility, ResponseOption, VesselDataset } from "@/types/maritime";

export interface Incident {
  lat: number;
  lon: number;
}

interface CompareInput {
  dataset: VesselDataset;
  frame: ActivityFrame;
  incident: Incident;
  radiusM: number;
  vesselSpeedKn: number;
  coastGuardSpeedKn: number;
  facilities: readonly Facility[];
  hypotheticalCoastGuard: Incident | null;
  limit?: number;
}

function nearestVerifiedMedical(facilities: readonly Facility[], lat: number, lon: number): Facility | null {
  let best: Facility | null = null;
  let bestDistance = Infinity;
  for (const facility of facilities) {
    if (facility.kind !== "medical" || !facility.verified) continue;
    const distance = distanceM(lon, lat, facility.lon, facility.lat);
    if (distance < bestDistance) {
      best = facility;
      bestDistance = distance;
    }
  }
  return best;
}

function withMedical(option: Omit<ResponseOption, "medicalName" | "medicalLegMin" | "combinedMin">, medical: Facility | null, incident: Incident): ResponseOption {
  if (!medical || option.etaMin == null) {
    return { ...option, medicalName: medical?.name ?? null, medicalLegMin: null, combinedMin: option.etaMin };
  }
  const medicalLegMin = etaMinutes(distanceM(incident.lon, incident.lat, medical.lon, medical.lat), option.assumedSpeedKn);
  return {
    ...option,
    medicalName: medical.name,
    medicalLegMin,
    combinedMin: medicalLegMin == null ? null : option.etaMin + medicalLegMin,
  };
}

export function compareResponses(input: CompareInput): ResponseOption[] {
  const medical = nearestVerifiedMedical(input.facilities, input.incident.lat, input.incident.lon);
  const options: ResponseOption[] = [];
  const ranked: { device: number; index: number; distance: number }[] = [];

  for (const position of input.frame.positions) {
    const distance = distanceM(input.incident.lon, input.incident.lat, input.dataset.lon[position.index], input.dataset.lat[position.index]);
    if (distance <= input.radiusM) ranked.push({ device: position.device, index: position.index, distance });
  }
  ranked.sort((a, b) => a.distance - b.distance);
  for (const item of ranked.slice(0, input.limit ?? 5)) {
    const reported = input.dataset.speed[item.index];
    const useReported = reported >= 1;
    const speed = useReported ? reported : input.vesselSpeedKn;
    options.push(
      withMedical(
        {
          id: `vessel-${item.device}`,
          label: input.dataset.names[item.device] || `Device ${item.device}`,
          evidence: "observed_position",
          distanceM: item.distance,
          assumedSpeedKn: speed,
          etaMin: etaMinutes(item.distance, speed),
          speedSource: useReported ? "reported_ping" : "assumed",
          reportedSpeedKn: reported,
          note: "Historical tracker position in the selected window. It is not a live vessel and it is not tasked to respond.",
        },
        medical,
        input.incident,
      ),
    );
  }

  for (const facility of input.facilities) {
    if (facility.kind !== "coast_guard") continue;
    const distance = distanceM(input.incident.lon, input.incident.lat, facility.lon, facility.lat);
    options.push(
      withMedical(
        {
          id: facility.id,
          label: facility.name,
          evidence: facility.verified ? "verified_coast_guard" : "unverified_coast_guard",
          distanceM: distance,
          assumedSpeedKn: input.coastGuardSpeedKn,
          etaMin: etaMinutes(distance, input.coastGuardSpeedKn),
          speedSource: "assumed",
          reportedSpeedKn: null,
          note: facility.verified
            ? "Loaded site is marked verified. Speed and readiness are still assumptions."
            : "Loaded site is not marked verified. Treat the location as unconfirmed.",
        },
        medical,
        input.incident,
      ),
    );
  }

  if (input.hypotheticalCoastGuard) {
    const distance = distanceM(
      input.incident.lon,
      input.incident.lat,
      input.hypotheticalCoastGuard.lon,
      input.hypotheticalCoastGuard.lat,
    );
    options.push(
      withMedical(
        {
          id: "hypothetical-coast-guard",
          label: "Hypothetical Coast Guard origin",
          evidence: "hypothetical_coast_guard",
          distanceM: distance,
          assumedSpeedKn: input.coastGuardSpeedKn,
          etaMin: etaMinutes(distance, input.coastGuardSpeedKn),
          speedSource: "assumed",
          reportedSpeedKn: null,
          note: "Origin placed on the map for this scenario. It is not a known station.",
        },
        medical,
        input.incident,
      ),
    );
  }

  return options.sort((a, b) => (a.combinedMin ?? Number.POSITIVE_INFINITY) - (b.combinedMin ?? Number.POSITIVE_INFINITY));
}
