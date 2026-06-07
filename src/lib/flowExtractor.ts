export type FlowExtractor = "vpf";
export type VpfDefinitionSize = 2 | 3;

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

export type VpfDefiningVolume = {
  sequence_index?: number;
  role?: "primary" | "secondary" | "tertiary" | string;
  traffic_volume_id?: string;
  timebins?: number[];
  start_bin?: number;
  end_bin?: number;
  segment_type?: "primary" | "overload" | string;
  is_primary?: boolean;
  sum_excess?: number;
  peak_excess?: number;
  volume?: VolumeDisplayInfo;
  time_window?: TimeWindowDisplayInfo;
};

export type VpfTopLevelMetadata = {
  primary_tv?: string;
  primary_timebins?: number[];
  primary_volume?: VolumeDisplayInfo;
  primary_time_window?: TimeWindowDisplayInfo;
  num_primary_flights?: number;
  min_flights?: number;
  max_flows?: number | null;
  supported_definition_sizes?: VpfDefinitionSize[];
  candidate_counts_by_definition_size_before_cap?: Record<string, number>;
  candidate_counts_by_definition_size_after_cap?: Record<string, number>;
  num_candidates_before_cap?: number;
  num_candidates_after_cap?: number;
  reason?: "empty_time_axis" | "empty_primary_window" | "no_primary_flights" | string;
};

export type VpfFlowMetadata = {
  extractor?: FlowExtractor;
  definition_size?: VpfDefinitionSize;
  ordered_volume_ids?: string[];
  flow_defining_volumes?: VpfDefiningVolume[];
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
  tertiary_tv?: string;
  tertiary_volume?: VolumeDisplayInfo;
  tertiary_start_bin?: number;
  tertiary_end_bin?: number;
  tertiary_time_window?: TimeWindowDisplayInfo;
  tertiary_sum_excess?: number;
  tertiary_peak_excess?: number;
  proxy_score?: number;
  proxy_components?: Record<string, unknown>;
};

export type FlowDefiningVolumeDisplay = {
  key: string;
  sequenceIndex: number;
  role: string;
  trafficVolumeId: string;
  label: string;
  windowLabel: string | null;
  isPrimary: boolean;
  segmentType: string | null;
  sumExcess: number | null;
  peakExcess: number | null;
  raw: VpfDefiningVolume;
};

export type FlowGroupMetadata = {
  primaryLabel?: string | null;
  primaryWindowLabel?: string | null;
  definitionSize?: VpfDefinitionSize | number | null;
  definingVolumes?: FlowDefiningVolumeDisplay[];
  proxyScore?: number | null;
  raw?: Partial<VpfFlowMetadata> | null;
};

export type FlowExtractorDisplayOptions = {
  timeBinMinutes?: number | null;
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

function normalizeNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function normalizeTimeBinMinutes(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatMinutesAsHHMM(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function getBinRange(startBin?: unknown, endBin?: unknown, timebins?: unknown): { startBin: number; endBin: number } | null {
  const start = normalizeNonNegativeInteger(startBin);
  const end = normalizeNonNegativeInteger(endBin);
  if (start !== null && end !== null) {
    return { startBin: Math.min(start, end), endBin: Math.max(start, end) };
  }

  if (!Array.isArray(timebins)) return null;
  const bins = timebins
    .map((value) => normalizeNonNegativeInteger(value))
    .filter((value): value is number => value !== null);
  if (bins.length === 0) return null;

  return {
    startBin: Math.min(...bins),
    endBin: Math.max(...bins),
  };
}

function formatBinRangeLabel(range: { startBin: number; endBin: number }, timeBinMinutes?: number | null): string {
  const safeBinMinutes = normalizeTimeBinMinutes(timeBinMinutes);
  if (!safeBinMinutes) {
    return range.startBin === range.endBin
      ? `bin ${range.startBin}`
      : `bins ${range.startBin}-${range.endBin}`;
  }

  const startMinutes = range.startBin * safeBinMinutes;
  const endMinutes = (range.endBin + 1) * safeBinMinutes;
  return `${formatMinutesAsHHMM(startMinutes)}-${formatMinutesAsHHMM(endMinutes)}`;
}

export function timeWindowDisplayLabel(
  window?: TimeWindowDisplayInfo | null,
  options: FlowExtractorDisplayOptions = {},
): string | null {
  const explicit = String(window?.label ?? "").trim();
  if (explicit) return explicit;
  const start = String(window?.start_time ?? "").trim();
  const end = String(window?.end_time ?? "").trim();
  if (start && end) return `${start}-${end}`;
  const range = getBinRange(window?.start_bin, window?.end_bin, window?.timebins);
  if (range) {
    return formatBinRangeLabel(range, window?.time_bin_minutes ?? options.timeBinMinutes);
  }
  return null;
}

function definingVolumeWindowDisplayLabel(
  volume: VpfDefiningVolume,
  options: FlowExtractorDisplayOptions,
): string | null {
  const nested = timeWindowDisplayLabel(volume.time_window, options);
  if (nested) return nested;

  const range = getBinRange(volume.start_bin, volume.end_bin, volume.timebins);
  if (!range) return null;
  return formatBinRangeLabel(range, volume.time_window?.time_bin_minutes ?? options.timeBinMinutes);
}

export function getVpfDefiningVolumes(
  flowMetadata?: Partial<VpfFlowMetadata> | null,
  topLevelMetadata?: VpfTopLevelMetadata | null,
): VpfDefiningVolume[] {
  const metadata = flowMetadata ?? {};
  if (Array.isArray(metadata.flow_defining_volumes) && metadata.flow_defining_volumes.length > 0) {
    return metadata.flow_defining_volumes
      .map((item, index) => ({
        ...item,
        sequence_index: Number.isFinite(Number(item?.sequence_index)) ? Number(item.sequence_index) : index,
      }))
      .sort((a, b) => Number(a.sequence_index ?? 0) - Number(b.sequence_index ?? 0));
  }

  const primaryTv = metadata.primary_tv ?? topLevelMetadata?.primary_tv;
  const primaryWindow = metadata.primary_time_window ?? topLevelMetadata?.primary_time_window;
  const fallback: Array<VpfDefiningVolume | null> = [
    primaryTv
      ? {
          sequence_index: 0,
          role: "primary",
          traffic_volume_id: primaryTv,
          timebins: metadata.primary_timebins ?? topLevelMetadata?.primary_timebins ?? primaryWindow?.timebins ?? [],
          start_bin: primaryWindow?.start_bin,
          end_bin: primaryWindow?.end_bin,
          segment_type: "primary",
          is_primary: true,
          volume: metadata.primary_volume ?? topLevelMetadata?.primary_volume,
          time_window: primaryWindow,
        }
      : null,
    metadata.secondary_tv
      ? {
          sequence_index: 1,
          role: "secondary",
          traffic_volume_id: metadata.secondary_tv,
          timebins: metadata.secondary_time_window?.timebins ?? [],
          start_bin: metadata.secondary_start_bin,
          end_bin: metadata.secondary_end_bin,
          segment_type: "overload",
          is_primary: false,
          sum_excess: metadata.secondary_sum_excess,
          peak_excess: metadata.secondary_peak_excess,
          volume: metadata.secondary_volume,
          time_window: metadata.secondary_time_window,
        }
      : null,
    metadata.tertiary_tv
      ? {
          sequence_index: 2,
          role: "tertiary",
          traffic_volume_id: metadata.tertiary_tv,
          timebins: metadata.tertiary_time_window?.timebins ?? [],
          start_bin: metadata.tertiary_start_bin,
          end_bin: metadata.tertiary_end_bin,
          segment_type: "overload",
          is_primary: false,
          sum_excess: metadata.tertiary_sum_excess,
          peak_excess: metadata.tertiary_peak_excess,
          volume: metadata.tertiary_volume,
          time_window: metadata.tertiary_time_window,
        }
      : null,
  ];

  return fallback.filter((item): item is VpfDefiningVolume => item !== null);
}

export function buildFlowDefiningVolumeDisplays(
  flowMetadata?: Partial<VpfFlowMetadata> | null,
  topLevelMetadata?: VpfTopLevelMetadata | null,
  options: FlowExtractorDisplayOptions = {},
): FlowDefiningVolumeDisplay[] {
  return getVpfDefiningVolumes(flowMetadata, topLevelMetadata)
    .map((item, index) => {
      const trafficVolumeId = String(item.traffic_volume_id ?? item.volume?.traffic_volume_id ?? "").trim();
      if (!trafficVolumeId) return null;
      const sequenceIndex = Number.isFinite(Number(item.sequence_index)) ? Number(item.sequence_index) : index;
      return {
        key: `${sequenceIndex}:${trafficVolumeId}`,
        sequenceIndex,
        role: String(item.role ?? (item.is_primary ? "primary" : "overload")),
        trafficVolumeId,
        label: volumeDisplayLabel(item.volume, trafficVolumeId) ?? trafficVolumeId,
        windowLabel: definingVolumeWindowDisplayLabel(item, options),
        isPrimary: Boolean(item.is_primary || item.role === "primary"),
        segmentType: item.segment_type ? String(item.segment_type) : null,
        sumExcess: Number.isFinite(Number(item.sum_excess)) ? Number(item.sum_excess) : null,
        peakExcess: Number.isFinite(Number(item.peak_excess)) ? Number(item.peak_excess) : null,
        raw: item,
      };
    })
    .filter((item): item is FlowDefiningVolumeDisplay => item !== null)
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
}

export function buildFlowGroupMetadata(
  flowMetadata?: Partial<VpfFlowMetadata> | null,
  topLevelMetadata?: VpfTopLevelMetadata | null,
  options: FlowExtractorDisplayOptions = {},
): FlowGroupMetadata {
  const definingVolumes = buildFlowDefiningVolumeDisplays(flowMetadata, topLevelMetadata, options);
  const definitionSize = Number.isFinite(Number(flowMetadata?.definition_size))
    ? Number(flowMetadata?.definition_size)
    : definingVolumes.length >= 2
      ? definingVolumes.length
      : null;
  return {
    primaryLabel: volumeDisplayLabel(
      flowMetadata?.primary_volume ?? topLevelMetadata?.primary_volume,
      flowMetadata?.primary_tv ?? topLevelMetadata?.primary_tv,
    ),
    primaryWindowLabel: timeWindowDisplayLabel(
      flowMetadata?.primary_time_window ?? topLevelMetadata?.primary_time_window,
      options,
    ),
    definitionSize,
    definingVolumes,
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
