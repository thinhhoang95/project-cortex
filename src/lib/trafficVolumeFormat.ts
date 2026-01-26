export function formatFlightLevel(value: unknown): string | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return `FL${Math.round(num).toString().padStart(3, "0")}`;
}

export function formatFlightLevelRange(minValue: unknown, maxValue: unknown): string | null {
  const minLabel = formatFlightLevel(minValue);
  const maxLabel = formatFlightLevel(maxValue);
  if (!minLabel || !maxLabel) return null;
  return `${minLabel}-${maxLabel}`;
}
