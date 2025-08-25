Can you implement a RegulationResults window as a component that receives the API call results, and display it. 

# UX Description
1. There is a header title Simulation Results, in big font.

2. Show a beautifully formatted delay_stats: total_delay_seconds, max_delay_seconds, delayed_flight_counts...

3. Draw 10x5 charts (50 items total) comparing the rolling hour occupancy count using pre_rolling_counts and post_rolling_counts for each traffic volume. The chart is a bar chart, but bars can be placed on top of each other. We compare the pre against the post: if post is higher than pre, a red bar is shown, if post is lower than pre, a green bar is shown for the difference between the two.

The whole window should bear a glassy appearance with dark blue tint, blur cranked to max, with a functional close button, that pops up when computation in RegulationPlanPanel is completed.


### API REFERENCE FOR: POST `/regulation_plan_simulation`

Simulates a regulation plan and returns per-flight delays, evaluation metrics, and rolling-hour occupancy for the top-K busiest TVs across all traffic volumes. TVs are ranked by max(pre_rolling_count − hourly_capacity) computed over the union of all active time windows provided in the plan.

You can provide regulations as raw strings in the `Regulation` DSL or as structured objects.

**Request (JSON):**
```json
{
  "regulations": [
    "TV_TVA IC__ 3 32",
    {
      "location": "TVA",
      "rate": 1,
      "time_windows": [32],
      "filter_type": "IC",
      "filter_value": "__",
      "target_flight_ids": ["F1", "F2", "F3"]
    }
  ],
  "weights": {"alpha": 1.0, "beta": 0.0, "gamma": 0.0, "delta": 0.0},
  "top_k": 50,
  "include_excess_vector": false
}
```

**Notes:**
- `regulations`: List of either raw strings like `TV_<LOC> <FILTER> <RATE> <TW>` or objects with `location`, `rate`, `time_windows`, and optional `filter_type`, `filter_value`, `target_flight_ids`.
- `weights`: Optional objective weights for combining overload and delay components.
- `top_k`: Number of busiest TVs to include (default: 25). Ranking is across all TVs, evaluated only on the union of the plan's active time windows.
- `include_excess_vector`: If true, returns the full post-regulation excess vector; otherwise returns compact stats.
- Hours/bins with no capacity are skipped when computing busy-ness.
- Ranking metric: `max(pre_rolling_count - hourly_capacity)` over the union mask of active regulation windows.

**Response:**
```json
{
  "delays_by_flight": {"F1": 5, "F2": 0},
  "delay_stats": {
    "total_delay_seconds": 300.0,
    "mean_delay_seconds": 150.0,
    "max_delay_seconds": 300.0,
    "min_delay_seconds": 0.0,
    "delayed_flights_count": 1,
    "num_flights": 2
  },
  "objective": 12.0,
  "objective_components": {
    "z_sum": 10.0,
    "z_max": 5.0,
    "delay_min": 5.0,
    "num_regs": 2,
    "alpha": 1.0,
    "beta": 2.0,
    "gamma": 0.1,
    "delta": 25.0
  },
  "rolling_top_tvs": [
    {
      "traffic_volume_id": "TVA",
      "pre_rolling_counts": [3.0, 4.0, 5.0],
      "post_rolling_counts": [2.0, 3.0, 4.0],
      "capacity_per_bin": [1.0, 1.0, 1.0],
      "active_time_windows": [32]
    }
  ],
  "excess_vector_stats": {"sum": 10.0, "max": 3.0, "mean": 0.1, "count": 9600},
  "metadata": {
    "top_k": 50,
    "time_bin_minutes": 15,
    "bins_per_tv": 384,
    "bins_per_hour": 4,
    "num_traffic_volumes": 1,
    "ranking_metric": "max(pre_rolling_count - hourly_capacity) over the union of active regulation windows"
  }
}
```