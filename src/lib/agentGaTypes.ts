export interface GaParetoPoint {
  point_id: string;
  frontier_index: number;
  capacity_objective: number;
  delay_minutes: number;
  capacity_improvement: number;
  combined_improvement: number;
  num_delayed_flights: number;
  is_knee: boolean;
}

export interface GaParetoFrontierResponse {
  run_id: string;
  methodology: "ga" | string;
  resource_date?: string | null;
  frontier_version?: number;
  baseline_capacity_objective?: number;
  default_point_id: string;
  points: GaParetoPoint[];
  metadata?: Record<string, unknown>;
}
