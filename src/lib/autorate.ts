import type { RegulationPlanPerAccAttrib } from "@/lib/models";

export type AutorateOccupancyResponse = {
  time_bin_minutes: number;
  num_bins?: number;
  tv_ids_order?: string[];
  timebins?: { labels?: string[] };
  pre_counts: Record<string, number[]>;
  post_counts: Record<string, number[]>;
  per_acc_attrib?: RegulationPlanPerAccAttrib;
  capacity?: Record<string, number[]>;
};

export function cloneAutorateOccupancyResponse(
  data: AutorateOccupancyResponse | null | undefined,
): AutorateOccupancyResponse | null {
  if (!data) return null;
  const cloneSeriesMap = (src?: Record<string, number[]>) => {
    if (!src) return undefined;
    const out: Record<string, number[]> = {};
    for (const [key, series] of Object.entries(src)) {
      out[key] = Array.isArray(series) ? [...series] : [];
    }
    return out;
  };
  const clone: AutorateOccupancyResponse = {
    time_bin_minutes: data.time_bin_minutes,
    num_bins: data.num_bins,
    tv_ids_order: data.tv_ids_order ? [...data.tv_ids_order] : undefined,
    timebins: data.timebins ? { labels: data.timebins.labels ? [...data.timebins.labels] : undefined } : undefined,
    pre_counts: cloneSeriesMap(data.pre_counts) || {},
    post_counts: cloneSeriesMap(data.post_counts) || {},
    per_acc_attrib: data.per_acc_attrib
      ? {
          mode: data.per_acc_attrib.mode,
          delay_minutes_by_acc: { ...(data.per_acc_attrib.delay_minutes_by_acc || {}) },
          metadata: data.per_acc_attrib.metadata ? { ...data.per_acc_attrib.metadata } : undefined,
        }
      : undefined,
    capacity: cloneSeriesMap(data.capacity),
  };
  return clone;
}
