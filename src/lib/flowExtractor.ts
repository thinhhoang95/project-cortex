export type FlowExtractor = "vpf";

export type VolumeDisplayInfo = {
  traffic_volume_id?: string;
  name?: string;
  display_name?: string;
  label?: string;
  tv_kind?: string;
  airspace_id?: string;
  aerodrome_id?: string;
  point_id?: string;
  min_fl?: number;
  max_fl?: number;
};

export type TimeWindowDisplayInfo = {
  timebins?: number[];
  start_bin?: number;
  end_bin?: number;
  start_time?: string;
  end_time?: string;
  label?: string;
  time_bin_minutes?: number;
};

export type VpfTopLevelMetadata = {
  primary_tv?: string;
  primary_timebins?: number[];
  primary_volume?: VolumeDisplayInfo;
  primary_time_window?: TimeWindowDisplayInfo;
  num_primary_flights?: number;
  min_flights?: number;
  max_flows?: number | null;
  reason?: "empty_time_axis" | "empty_primary_window" | "no_primary_flights" | string;
};

export type VpfFlowMetadata = {
  extractor?: FlowExtractor;
  primary_tv?: string;
  primary_timebins?: number[];
  primary_volume?: VolumeDisplayInfo;
  primary_time_window?: TimeWindowDisplayInfo;
  secondary_tv?: string;
  secondary_volume?: VolumeDisplayInfo;
  secondary_start_bin?: number;
  secondary_end_bin?: number;
  secondary_time_window?: TimeWindowDisplayInfo;
  secondary_sum_excess?: number;
  secondary_peak_excess?: number;
  proxy_score?: number;
  proxy_components?: Record<string, number>;
};

export type FlowGroupMetadata = {
  primaryLabel?: string | null;
  primaryWindowLabel?: string | null;
  secondaryLabel?: string | null;
  secondaryWindowLabel?: string | null;
  proxyScore?: number | null;
  raw?: Partial<VpfFlowMetadata> | null;
};

export function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

export function normalizeOptionalPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.floor(parsed));
}

export function volumeDisplayLabel(volume?: VolumeDisplayInfo | null, fallback?: string | null): string | null {
  const candidates = [
    volume?.display_name,
    volume?.label,
    volume?.name,
    volume?.traffic_volume_id,
    fallback,
  ];
  for (const candidate of candidates) {
    const label = String(candidate ?? "").trim();
    if (label) return label;
  }
  return null;
}

export function timeWindowDisplayLabel(window?: TimeWindowDisplayInfo | null): string | null {
  const explicit = String(window?.label ?? "").trim();
  if (explicit) return explicit;
  const start = String(window?.start_time ?? "").trim();
  const end = String(window?.end_time ?? "").trim();
  if (start && end) return `${start}-${end}`;
  return null;
}

export function buildFlowGroupMetadata(
  flowMetadata?: Partial<VpfFlowMetadata> | null,
  topLevelMetadata?: VpfTopLevelMetadata | null,
): FlowGroupMetadata {
  return {
    primaryLabel: volumeDisplayLabel(
      flowMetadata?.primary_volume ?? topLevelMetadata?.primary_volume,
      flowMetadata?.primary_tv ?? topLevelMetadata?.primary_tv,
    ),
    primaryWindowLabel: timeWindowDisplayLabel(
      flowMetadata?.primary_time_window ?? topLevelMetadata?.primary_time_window,
    ),
    secondaryLabel: volumeDisplayLabel(flowMetadata?.secondary_volume, flowMetadata?.secondary_tv),
    secondaryWindowLabel: timeWindowDisplayLabel(flowMetadata?.secondary_time_window),
    proxyScore: Number.isFinite(Number(flowMetadata?.proxy_score)) ? Number(flowMetadata?.proxy_score) : null,
    raw: flowMetadata ?? null,
  };
}

export function deriveMembershipsFromGroups(groups: Record<string, string[]> | null | undefined): Record<string, number[]> | null {
  if (!groups || Object.keys(groups).length === 0) return null;
  const byFlight = new Map<string, number[]>();
  for (const [groupId, flightIds] of Object.entries(groups)) {
    const numericGroupId = Number(groupId);
    const normalizedGroupId = Number.isFinite(numericGroupId) ? numericGroupId : Number.parseInt(groupId, 10);
    if (!Number.isFinite(normalizedGroupId)) continue;
    for (const rawFlightId of flightIds || []) {
      const flightId = String(rawFlightId ?? "").trim();
      if (!flightId) continue;
      const memberships = byFlight.get(flightId) ?? [];
      if (!memberships.includes(normalizedGroupId)) memberships.push(normalizedGroupId);
      byFlight.set(flightId, memberships);
    }
  }
  if (byFlight.size === 0) return null;
  return Object.fromEntries(Array.from(byFlight.entries()).map(([flightId, ids]) => [flightId, ids.sort((a, b) => a - b)]));
}

export function derivePrimaryCommunitiesFromMemberships(
  memberships: Record<string, number[]> | null | undefined,
): Record<string, number> | null {
  if (!memberships || Object.keys(memberships).length === 0) return null;
  const communities: Record<string, number> = {};
  for (const [flightId, groupIds] of Object.entries(memberships)) {
    const first = Array.isArray(groupIds) ? groupIds.find((id) => Number.isFinite(Number(id))) : null;
    if (first !== null && first !== undefined) communities[String(flightId)] = Number(first);
  }
  return Object.keys(communities).length > 0 ? communities : null;
}
