import type { RegulationPlanPerAccAttrib, WithHotspotDiffs } from "@/lib/models";

export type SaObjectiveHistorySeries = "best" | "current";

export interface SaObjectiveHistory {
  series: SaObjectiveHistorySeries | string;
  iterations: number[];
  total_improvement: number[];
  delay_component_delta: number[];
  capacity_component_delta: number[];
}

export interface SaConvergenceFit {
  model?: string;
  formula?: string;
  asymptote_improvement?: number | null;
  rate_constant?: number | null;
  r_squared?: number | null;
}

export interface SaSummaryMetrics {
  initial_total_objective?: number | null;
  final_total_objective?: number | null;
  final_total_objective_improvement?: number | null;
  final_capacity_excess_delta?: number | null;
  final_delay_component_delta?: number | null;
  objective_improvement_per_delayed_flight?: number | null;
  num_delayed_flights?: number | null;
  average_delay_min?: number | null;
  std_delay_min?: number | null;
  total_delay_min?: number | null;
}

export interface SaBestSolution {
  objectives?: {
    J_total?: number | null;
    J_cap?: number | null;
    J_delay?: number | null;
    [key: string]: number | null | undefined;
  };
  total_delay_min?: number | null;
  delays_by_flight?: Record<string, number>;
}

export interface SaTvReliefTopTv {
  traffic_volume_id: string;
  absolute_dynamics: number;
  signed_net_change: number;
  changed_bins: number;
}

export interface SaTvReliefWindow {
  label: string;
  display_label?: string;
  start_hour_utc?: number;
  end_hour_utc?: number;
  start_bin?: number;
  end_bin_exclusive?: number;
  total_absolute_dynamics?: number | null;
  max_tv_id?: string | null;
  max_tv_value?: number | null;
  top_tvs?: SaTvReliefTopTv[];
}

export interface SaTvRelief {
  metric?: string;
  time_bin_minutes?: number;
  windows?: SaTvReliefWindow[];
  absolute_maps?: Record<string, Record<string, number>>;
  global_vmax?: number | null;
  unmatched_tv_ids?: string[];
}

export interface SaAccAttributedDelay {
  mode?: string;
  delay_minutes_by_acc: Record<string, number>;
  top_accs?: Array<{
    acc: string;
    attributed_delay_minutes: number;
  }>;
  metadata?: Record<string, unknown>;
}

export interface SaOdAttributedDelayPair {
  origin: string;
  destination: string;
  od_pair: string;
  delay_minutes: number;
  num_delayed_flights: number;
}

export interface SaOdAttributedDelay {
  delay_minutes_by_od?: Record<string, number>;
  pairs?: SaOdAttributedDelayPair[];
  metadata?: Record<string, unknown>;
}

export interface SaPosthocAnalysisResponse {
  run_id: string;
  methodology: "sa" | string;
  analysis_version?: number;
  objective_history?: SaObjectiveHistory;
  convergence_fit?: SaConvergenceFit;
  summary_metrics?: SaSummaryMetrics;
  best_solution?: SaBestSolution;
  tv_relief?: SaTvRelief;
  acc_attributed_delay_full_day?: SaAccAttributedDelay;
  od_attributed_delay_full_day?: SaOdAttributedDelay;
  metadata?: Record<string, unknown>;
}

export interface SaPosthocOccupancyPrePost extends WithHotspotDiffs {
  time_bin_minutes: number;
  num_bins?: number;
  tv_ids_order?: string[];
  timebins?: {
    labels?: string[];
  };
  pre_counts?: Record<string, number[]>;
  post_counts?: Record<string, number[]>;
  delta_counts?: Record<string, number[]>;
  capacity?: Record<string, number[]>;
}

export interface SaPosthocOccupancySummary {
  total_delayed_flights?: number;
  changed_tv_count?: number;
}

export interface SaPosthocOccupancyResponse {
  run_id: string;
  methodology: "sa" | string;
  pre_post?: SaPosthocOccupancyPrePost;
  summary?: SaPosthocOccupancySummary;
  metadata?: Record<string, unknown>;
}

export function toSaPerAccAttrib(
  payload: SaAccAttributedDelay | null | undefined,
): RegulationPlanPerAccAttrib | null {
  if (!payload?.delay_minutes_by_acc) return null;
  return {
    mode: payload.mode ?? "dwelling_spread",
    delay_minutes_by_acc: payload.delay_minutes_by_acc,
    metadata: payload.metadata,
  };
}
