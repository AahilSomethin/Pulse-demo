"use client";

import { useMemo } from "react";

import { ANOMALY } from "@/config/constants";
import { classifyDataset, countLowRateDevices, medianGapSec } from "@/lib/analytics/track-quality";
import { formatCount, formatDuration } from "@/lib/format";
import type { VesselDataset } from "@/types/maritime";

export function TrackingQualityNote({ dataset, device }: { dataset: VesselDataset; device?: number }) {
  const jumps = useMemo(() => classifyDataset(dataset, device), [dataset, device]);
  const lowRate = useMemo(() => (device == null ? countLowRateDevices(dataset) : null), [dataset, device]);
  const gapSec = useMemo(() => {
    if (device == null) return null;
    const track = dataset.tracks[device] ?? [];
    return medianGapSec(track.map((index) => dataset.timeMs[index]));
  }, [dataset, device]);
  const who = device == null ? "On the loaded day" : "For this device";

  return (
    <section className="mt-3 space-y-2">
      <h3 className="text-sm font-semibold">Tracking quality</h3>
      {jumps.examined === 0 ? (
        <p className="text-sm leading-6 text-fg-secondary">{who}, no jump between reports was both longer than {ANOMALY.jumpMinM} m and faster than 40 knots in a straight line.</p>
      ) : (
        <p className="text-sm leading-6 text-fg-secondary">
          {who}, {formatCount(jumps.examined)} jumps between reports were longer than {ANOMALY.jumpMinM} m and faster than 40 knots in a straight line. {formatCount(jumps.fastReported)} also had a high reported speed, so they look like fast recorded movement. {formatCount(jumps.positionJump)} had a low reported speed, which fits a bad GPS point better than real travel. {formatCount(jumps.outAndBack)} are followed by a point that returns close to the earlier position, which also fits a single bad point.
        </p>
      )}
      {lowRate && lowRate.devicesWithGaps > 0 ? (
        <p className="text-xs leading-5 text-fg-muted">{formatCount(lowRate.lowRate)} of {formatCount(lowRate.devicesWithGaps)} devices have a typical gap of 15 minutes or more. Short movements on those devices are easy to miss.</p>
      ) : null}
      {gapSec != null && gapSec >= ANOMALY.lowRateMedianSec ? (
        <p className="text-xs leading-5 text-fg-muted">This device’s typical gap between reports is {formatDuration(gapSec * 1000)}, so short movements can be missed.</p>
      ) : null}
      <p className="text-xs leading-5 text-fg-muted">These notes separate possible GPS errors from fast recorded movement. They are not collisions, accidents, or confirmed incidents. Shorter jumps stay in the day’s existing 40-knot count.</p>
    </section>
  );
}
