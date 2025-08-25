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
  min_fl: number;
  max_fl: number;
  [k: string]: unknown;
}

// Regulation plan simulation models
export interface RegulationPlanDelayStats {
  total_delay_seconds: number;
  mean_delay_seconds: number;
  max_delay_seconds: number;
  min_delay_seconds: number;
  delayed_flights_count: number;
  num_flights: number;
}

export interface RegulationPlanObjectiveComponents {
  z_sum: number;
  z_max: number;
  delay_min: number;
  num_regs: number;
  alpha: number;
  beta: number;
  gamma: number;
  delta: number;
}

export interface RegulationPlanRollingTv {
  traffic_volume_id: string;
  pre_rolling_counts: number[];
  post_rolling_counts: number[];
  capacity_per_bin: number[];
  active_time_windows: number[];
}

export interface RegulationPlanMetadata {
  top_k: number;
  time_bin_minutes: number;
  bins_per_tv: number;
  bins_per_hour: number;
  num_traffic_volumes: number;
  ranking_metric: string;
}

export interface RegulationPlanSimulationResponse {
  delays_by_flight: Record<string, number>;
  delay_stats: RegulationPlanDelayStats;
  objective: number;
  objective_components: RegulationPlanObjectiveComponents;
  rolling_top_tvs: RegulationPlanRollingTv[];
  excess_vector_stats?: { sum: number; max: number; mean: number; count: number };
  metadata: RegulationPlanMetadata;
}