import type {
  ResourceStateDelayHistogram,
  ResourceStateDelayHistogramBin,
  ResourceStateSummary,
} from "@/lib/resourceStates";

export type NetworkStatusDelayCause = {
  cause: string;
  delayMinutes: number | null;
};

export type NetworkStatusHistogramBin = {
  bucket: string;
  count: number;
};

export const NETWORK_STATUS_DELAY_CAUSE_LABELS = [
  "Weather",
  "ATC Staffing",
  "Runway Congestion",
  "Aircraft Readiness",
  "Ground Operations",
  "Security",
  "Airspace Restrictions",
  "Late Inbound",
  "Crew",
  "Other",
] as const;

function toFiniteNonNegativeNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric;
}

export function buildNetworkStatusDelayCauseRows(
  labels: readonly string[] = NETWORK_STATUS_DELAY_CAUSE_LABELS,
): NetworkStatusDelayCause[] {
  return labels.map((label) => ({
    cause: String(label),
    delayMinutes: null,
  }));
}

export function findSelectedResourceState(
  states: ResourceStateSummary[] | null | undefined,
  selectedStateId: string | null | undefined,
): ResourceStateSummary | null {
  if (!Array.isArray(states) || states.length === 0) return null;

  const normalizedSelectedStateId = String(selectedStateId ?? "").trim();
  return (
    states.find((state) => state.state_id === normalizedSelectedStateId) ??
    states.find((state) => state.is_selected) ??
    null
  );
}

export function buildNetworkStatusDelayHistogramRows(
  bins: ResourceStateDelayHistogramBin[] | null | undefined,
  histogram: ResourceStateDelayHistogram | null | undefined,
): NetworkStatusHistogramBin[] {
  if (!Array.isArray(bins) || bins.length === 0) return [];

  const counts = histogram ?? {};
  return bins
    .map((bin) => {
      const bucket = String(bin?.label ?? bin?.key ?? "").trim();
      const key = String(bin?.key ?? "").trim();
      if (!bucket || !key) return null;

      return {
        bucket,
        count: Math.trunc(toFiniteNonNegativeNumber(counts[key])),
      } satisfies NetworkStatusHistogramBin;
    })
    .filter((row): row is NetworkStatusHistogramBin => row !== null);
}

export function computeAverageDelayMinutes(
  totalCumulativeDelayMinutes: unknown,
  flightsTotal: unknown,
): number {
  const total = toFiniteNonNegativeNumber(totalCumulativeDelayMinutes);
  const count = toFiniteNonNegativeNumber(flightsTotal);
  if (count <= 0 || total <= 0) return 0;
  return Math.round((total / count) * 10) / 10;
}
