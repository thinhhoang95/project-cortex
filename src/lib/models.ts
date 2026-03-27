export type HmsCompact = string; // e.g., "754" => 00:07:54, "50007" => 05:00:07

export interface FlightSegment {
  segment_identifier: string;
  flight_identifier: string;
  call_sign: string;
  origin_aerodrome: string;
  destination_aerodrome: string;
  date_begin_segment: string; // e.g., "230801"
  date_end_segment: string;
  time_begin_segment: HmsCompact;
  time_end_segment: HmsCompact;
  latitude_begin: number;
  longitude_begin: number;
  latitude_end: number;
  longitude_end: number;
  flight_level_begin: number;
  flight_level_end: number;
  sequence: number;
}

export interface Trajectory {
  flightId: string;
  callSign?: string;
  origin?: string;
  destination?: string;
  // coordinates sorted by time
  coords: [number, number, number?][]; // [lon, lat, alt_ft]
  t0: number; // seconds since midnight
  t1: number; // seconds since midnight
  // per-vertex absolute time (sec since midnight)
  times: number[];
}

export interface SectorFeatureProps {
  traffic_volume_id: string;
  name?: string;
  min_fl?: number | string;
  max_fl?: number | string;
  tv_kind?: string;
  capacity?: Record<string, number | string>;
  [k: string]: unknown;
}

// Regulation plan simulation models
export interface RegulationPlanDelayStats {
  total_delay_seconds?: number;
  total_delay_minutes?: number;
  mean_delay_seconds?: number;
  mean_delay_minutes?: number;
  max_delay_seconds?: number;
  max_delay_minutes?: number;
  min_delay_seconds?: number;
  min_delay_minutes?: number;
  delayed_flights_count?: number;
  num_delayed?: number;
  num_flights?: number;
}

export interface RegulationPlanObjectiveComponents {
  [component: string]: number | undefined;
  J_cap?: number;
  J_delay?: number;
  J_reg?: number;
  J_tv?: number;
  J_share?: number;
  J_spill?: number;
}

export interface RegulationPlanLegacyObjectiveComponents {
  [component: string]: number | undefined;
  z_sum?: number;
  z_max?: number;
  delay_min?: number;
  num_regs?: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  delta?: number;
}

export type RegulationPlanPerAccAttribMode = "dwelling_spread" | "control_volume";

export interface RegulationPlanPerAccAttribMetadata {
  acc_prefix_len?: number;
  total_delay_minutes?: number;
  attributed_delay_minutes?: number;
  unattributed_delay_minutes?: number;
  num_flights_in_delay_map?: number;
  num_delayed_flights?: number;
  num_attributed_delayed_flights?: number;
  num_unattributed_delayed_flights?: number;
  dwell_policy?: string;
  [extra: string]: unknown;
}

export interface RegulationPlanPerAccAttrib {
  mode: RegulationPlanPerAccAttribMode | string;
  delay_minutes_by_acc: Record<string, number>;
  metadata?: RegulationPlanPerAccAttribMetadata;
}

export interface RegulationPlanRollingTv {
  traffic_volume_id: string;
  pre_rolling_counts: number[];
  post_rolling_counts: number[];
  capacity_per_bin: number[];
  active_time_windows: number[];
  tv_kind?: string;
}

export interface RegulationPlanMetadata {
  time_bin_minutes: number;
  bins_per_tv: number;
  bins_per_hour: number;
  num_traffic_volumes: number;
  num_changed_tvs?: number;
  num_flows?: number;
  tvs_scored?: string[];
  deprecated?: Record<string, string>;
  top_k?: number;
  ranking_metric?: string;
  [extra: string]: unknown;
}

export interface RegulationPlanPreFlightContextEntry {
  takeoff_time: string;
  tv_arrival_time: string | null;
}

export interface HotspotSegment {
  traffic_volume_id: string;
  start_bin: number;
  end_bin: number;
  start_label: string;
  end_label: string;
  time_bin_minutes: number;
  window_minutes: number;
  max_excess: number;
  sum_excess: number;
  peak_rolling_count: number;
  capacity_stats: {
    min: number;
    max: number;
  };
}

export interface HotspotChangeSummary {
  traffic_volume_id: string;
  new_hotspot_bin_count: number;
  extinguished_hotspot_bin_count: number;
  net_hotspot_bin_delta: number;
  new_hotspot_segment_count: number;
  extinguished_hotspot_segment_count: number;
}

export interface WithHotspotDiffs {
  new_hotspots?: HotspotSegment[];
  extinguished_hotspots?: HotspotSegment[];
  hotspot_change_summary?: HotspotChangeSummary[];
}

export interface RegulationPlanSimulationResponse extends WithHotspotDiffs {
  delays_by_flight: Record<string, number>;
  per_acc_attrib?: RegulationPlanPerAccAttrib;
  pre_flight_context?: Record<string, RegulationPlanPreFlightContextEntry>;
  delay_stats: RegulationPlanDelayStats;
  pre_objective?: number;
  objective: number;
  delta_objective?: number;
  objective_components: RegulationPlanObjectiveComponents;
  legacy_objective?: number;
  legacy_objective_components?: RegulationPlanLegacyObjectiveComponents;
  rolling_changed_tvs?: RegulationPlanRollingTv[];
  rolling_top_tvs?: RegulationPlanRollingTv[];
  excess_vector_stats?: { sum: number; max: number; mean: number; count: number };
  excess_vector?: unknown;
  weights_used?: Record<string, number>;
  metadata: RegulationPlanMetadata;
}

// Flow Impact Evaluation models
export interface FlowEval {
  flow_id: number;
  controlled_volume: string | null;
  n0: number[]; // length T+1
  demand: number[]; // length T
  target_demands: Record<string, number[]>; // tv -> series length T
  ripple_demands?: Record<string, number[]>; // tv -> series length T
  // New in revised API: realized per-bin occupancy under baseline schedule (no delays)
  target_occupancy?: Record<string, number[]>; // tv -> series length T
  ripple_occupancy?: Record<string, number[]>; // tv -> series length T
}

export interface BaseEvaluationResponse {
  num_time_bins: number;
  tvs: string[];
  target_cells: Array<[string, number]>;
  ripple_cells?: Array<[string, number]>;
  flows: FlowEval[];
  objective: { score: number; components: Record<string, number> };
  weights_used?: Record<string, number>;
}

// Optimization results (automatic rate adjustment)
export interface FlowOptResult {
  flow_id: number;
  controlled_volume: string | null;
  n0: number[];            // length T+1
  demand: number[];        // length T
  n_opt: number[];         // length T+1
  target_demands: Record<string, number[]>; // baseline earliest crossings
  ripple_demands?: Record<string, number[]>;
  target_occupancy_opt?: Record<string, number[]>; // realized occupancy post-optimization
  ripple_occupancy_opt?: Record<string, number[]>;
}

export interface AutomaticRateAdjustmentResponse {
  num_time_bins: number;
  tvs: string[];
  target_cells: Array<[string, number]>;
  ripple_cells?: Array<[string, number]>;
  flows: FlowOptResult[];
  delays_min?: Record<string, number>; // flight_id -> delay minutes
  per_acc_attrib?: RegulationPlanPerAccAttrib;
  objective_baseline: { score: number; components: Record<string, number> };
  objective_optimized: { score: number; components: Record<string, number> };
  improvement: { absolute: number; percent: number };
  weights_used?: Record<string, number>;
  sa_params_used?: Record<string, number>;
}

// Shared occupancy types
export type OccupancySeriesByTv = Record<string, number[]>;

export interface PrePostOccupancyData extends WithHotspotDiffs {
  time_bin_minutes: number;
  pre_counts?: OccupancySeriesByTv;
  post_counts: OccupancySeriesByTv;
  capacity?: OccupancySeriesByTv;
  tv_ids_order?: string[];
}

export interface AlternativeRouteSegment {
  segment_identifier: string;
  origin_aerodrome: string;
  destination_aerodrome: string;
  time_begin_segment: number;
  time_end_segment: number;
  flight_level_begin: number;
  flight_level_end: number;
  latitude_begin: number;
  longitude_begin: number;
  latitude_end: number;
  longitude_end: number;
  route: string;
  p_route: number;
}

export interface AlternativeRouteResponse {
  flight_identifier: string;
  segments: AlternativeRouteSegment[];
  metadata: {
    num_segments: number;
    bq_table: string;
  };
}
