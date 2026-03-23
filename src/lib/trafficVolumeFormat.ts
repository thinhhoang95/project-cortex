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

export function formatCrossingFlightLevelRange(
  range:
    | {
        min_fl?: number | null;
        max_fl?: number | null;
        label?: string | null;
      }
    | null
    | undefined,
): string | null {
  const label = String(range?.label ?? "").trim();
  if (label) {
    const compactLabel = label.match(/^FL\s*(-?\d+)(?:-FL\s*(-?\d+))?$/i);
    if (compactLabel) {
      const [, start, end] = compactLabel;
      return end ? `${start}-${end}` : start;
    }
    return label;
  }

  const minFl = typeof range?.min_fl === "number" ? range.min_fl : Number(range?.min_fl);
  const maxFl = typeof range?.max_fl === "number" ? range.max_fl : Number(range?.max_fl);
  if (!Number.isFinite(minFl) || !Number.isFinite(maxFl)) return null;
  if (minFl < 0 || maxFl < 0) return "-1";
  return `${Math.round(minFl)}-${Math.round(maxFl)}`;
}
