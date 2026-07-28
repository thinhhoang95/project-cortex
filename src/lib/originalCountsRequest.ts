import { dedupeTrafficVolumeIds } from "@/lib/globalTvBasket";

export type OriginalCountsRequestInput = {
  requestedTrafficVolumeIds: readonly string[];
  fromTime: string;
  toTime: string;
  rollingHour: boolean;
  rankBy: string;
};

export function buildOriginalCountsRequest({
  requestedTrafficVolumeIds,
  fromTime,
  toTime,
  rollingHour,
  rankBy,
}: OriginalCountsRequestInput): Record<string, unknown> {
  const trafficVolumeIds = dedupeTrafficVolumeIds(requestedTrafficVolumeIds);
  return {
    ...(trafficVolumeIds.length > 0 ? { traffic_volume_ids: trafficVolumeIds } : {}),
    from_time_str: fromTime,
    to_time_str: toTime,
    rolling_hour: Boolean(rollingHour),
    rank_by: rankBy,
  };
}
