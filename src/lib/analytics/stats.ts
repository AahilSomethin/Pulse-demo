/** Type-7 quantile (linear interpolation). One pooled sample, never an average of daily percentiles. */
export function quantile(values: readonly number[], probability: number): number | null {
  if (values.length === 0 || probability < 0 || probability > 1) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function quartileRange(values: readonly number[], minimum: number): number | null {
  if (values.length < minimum) return null;
  const lower = quantile(values, 0.25);
  const upper = quantile(values, 0.75);
  if (lower == null || upper == null) return null;
  return upper - lower;
}

/** Median absolute deviation from the median. Null when the list is empty. Zero means no spread. */
export function medianAbsoluteDeviation(values: readonly number[]): number | null {
  const mid = quantile(values, 0.5);
  if (mid == null) return null;
  return quantile(values.map((value) => Math.abs(value - mid)), 0.5);
}

/** Population coefficient of variation. Null when the mean is not positive. */
export function coefficientOfVariation(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!(mean > 0)) return null;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}
