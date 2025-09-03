Please help me plan for the following Flow Impact Evaluation interface. No need to write any code yet, please first plan in detail for the implementation in the context of the project.

# Endpoint

The page receives the input json of the given form (described in the API POST below), query the API and receive the output of the format below.

# Instructions

When displaying the results, I would like the page two contain many of the following sections:

1. A summary of input, please decide on how to best represent the input data: showing each flow with the number of flights, the traffic volume IDs for target and ripple cells, as long as the time period for each cell. Please decide on how to best represent this: aesthetically and informative.

2. There is a `TimeScaleControl` bar which allows to control the range of x axis for all histogram charts (shown below).

3. For the results, **for each flow**:

    - Show the histogram charts for each traffic volume in `target_demands` and `ripple_demands`. Beneath each histogram chart.

    - The control volume will be outline bordered in red-pink, at the first position among all histogram charts of this particular flow.

4. Finally, there is a section to show (in dashboard style) the objective function values.

5. Connect 


# API Reference

### POST `/base_evaluation`

Compute the baseline schedule and objective for a set of user-provided flows and time windows over target TVs. This endpoint prepares scheduling inputs using the existing policy (controlled-volume selection among targets, requested bins per flight), builds the baseline schedule `n0` (equal to demand), and evaluates the objective with current capacities and weights.

Additionally, for each flow it returns per-TV demand vectors for both target and ripple TVs.

#### JSON body
- **flows** (required, object): Mapping of flow-id -> list of flight IDs. Flow IDs may be strings or numeric; they are coerced to integers deterministically.
- **targets** (required, object): Mapping `TV_ID -> {"from": "HH:MM[:SS]", "to": "HH:MM[:SS]"}`. Defines attention cells for target TVs.
- **ripples** (optional, object): Same schema as `targets`. Defines secondary attention cells.
- **indexer_path** (optional, string): Override path to `tvtw_indexer.json`. Default: `data/tailwind/tvtw_indexer.json`.
- **flights_path** (optional, string): Override path to `so6_occupancy_matrix_with_times.json`. Default: `data/tailwind/so6_occupancy_matrix_with_times.json`.
- **capacities_path** (optional, string): Override path to capacities GeoJSON. Default: `data/cirrus/wxm_sm_ih_maxpool.geojson`.
- **weights** (optional, object): Partial overrides for `ObjectiveWeights` (e.g., `{"alpha_gt": 10.0, "lambda_delay": 0.1}`).

Validation errors (HTTP 400) are returned if:
- **flows** is missing or not an object
- **targets** is missing or empty
- Time ranges are malformed (HH:MM or HH:MM:SS required)

Unknown items are ignored gracefully:
- Unknown TV IDs in `targets`/`ripples` are dropped
- Unknown flight IDs in `flows` are ignored

#### 200 OK response
Top-level object:
- **num_time_bins** (int): Number of bins in the day.
- **tvs** (string[]): List of target TV IDs considered for control.
- **target_cells** (Array<[string, int]>): Explicit (tv, bin) pairs from `targets`.
- **ripple_cells** (Array<[string, int]>): Explicit (tv, bin) pairs from `ripples`.
- **flows** (FlowEval[]): Evaluation per flow.
- **objective** (object): `{"score": number, "components": {"J_cap": number, "J_delay": number, "J_reg": number, "J_tv": number, ...}}`.
- **weights_used** (object): Effective weights after overrides.

FlowEval object:
- **flow_id** (int)
- **controlled_volume** (string|null)
- **n0** (int[]): Length `T+1` array; counts by requested bin including overflow at index `T`.
- **demand** (int[]): Length `T` array; `n0` without overflow.
 - **target_demands** (object): Mapping `TV_ID -> int[]` (length `T`) giving earliest-crossing demand per time bin for each target TV.
 - **ripple_demands** (object): Mapping `TV_ID -> int[]` (length `T`) giving earliest-crossing demand per time bin for each ripple TV.

#### Example
Request:
```bash
curl -X POST http://localhost:8000/base_evaluation \
  -H 'Content-Type: application/json' \
  -d '{
    "flows": {"0": ["FLIGHT_1", "FLIGHT_2"], "1": ["FLIGHT_3"]},
    "targets": {"TV_A": {"from": "08:00", "to": "09:00"}},
    "ripples": {"TV_B": {"from": "09:00", "to": "09:30"}},
    "weights": {"alpha_gt": 10.0, "lambda_delay": 0.1}
  }'
```

Response (truncated):
```json
{
  "num_time_bins": 48,
  "tvs": ["TV_A"],
  "target_cells": [["TV_A", 16], ["TV_A", 17]],
  "ripple_cells": [["TV_B", 18]],
  "flows": [
    {
      "flow_id": 0,
      "controlled_volume": "TV_A",
      "n0": [0,0,0,1,0, ...],
      "demand": [0,0,0,1,0, ...],
      "target_demands": {"TV_A": [0,0,0,1,0, ...]},
      "ripple_demands": {"TV_B": [0,0,1,0,0, ...]}
    }
  ],
  "objective": {
    "score": 9546.9,
    "components": {"J_cap": 9056.5, "J_delay": 441.0, "J_reg": 39.6, "J_tv": 9.8}
  },
  "weights_used": {"alpha_gt": 10.0, "alpha_rip": 3.0, "alpha_ctx": 0.5, "beta_gt": 0.1, ...}
}
```

#### Notes
- Controlled volume selection is restricted to TVs provided in `targets`.
- Requested bins per flight are the earliest crossing at the controlled volume; if absent, earliest among targets; else 0.
- Time windows map to bins via half-open intervals `[from, to)`. If `to <= from`, the window is ignored.
- Capacities are loaded per TV from the GeoJSON and used in `J_cap` via rolling-hour exceedance.
- `n0` includes an overflow bin at index `T` by design; `demand` excludes overflow.
