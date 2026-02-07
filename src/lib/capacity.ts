/**
 * Normalize a capacity value for display.
 *
 * Some datasets use large sentinel values (e.g., 999 or 9999) to indicate
 * that capacity is effectively unlimited. These should not be plotted because
 * they distort chart scales. Any invalid or negative values are also treated
 * as unavailable.
 * Values >998 are filtered out to prevent y-axis scaling issues in histograms.
 */
export function normalizeCapacity(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  if (num > 998) return null;
  return num;
}

