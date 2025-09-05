Can you help me plan to integrate the optimization call to automatically set the rate for selected flows from the interface of `src/app/flow-evaluation/page.tsx`.

When clicking on the button "Optimize the World's Best Optimization Algorithm...", make an API call to `/automatic_rate_adjustment` with the current payload input (see the API reference below), and obtain the response.

It is important to keep the current baseline evaluation, as it will be helpful to show the changes/differences on the interface.

# Instructions

1. Plan for the approach to integrate the API call and retrieve the response. You may need to create a new Next.js route, as well as managing the response states.

2. If both responses (baseline and post-optimization) are available, show the **changes** (for context: the set of traffic volumes remains the same between pre and post optimization since we only delay flights, without rerouting).

    - For objective values, show an arrow: pre -> post values.

    - For histogram barcharts, show the per-time-bin differences by showing the multi-bar chart. 

    - Beneath each histogram barchart, show some statistics: for example: Total Occupancies, Peak Occupancy.

# API Reference

# POST `/automatic_rate_adjustment` — Simulated Annealing Rate Optimization

Optimize per‑flow release rates at the controlled volume using Simulated Annealing (SA). This endpoint reuses the baseline preparation from `/base_evaluation` (controlled‑volume selection, requested bins, baseline schedule and objective), then runs SA to produce an improved schedule. It returns baseline vs optimized objectives, per‑flow optimized schedules, and realized occupancy per target/ripple TV.

This document describes the request/response schema, validation behavior, examples, and practical usage tips.

---

## Overview

- Purpose: Compute an optimized release schedule `n_opt` for user‑provided flows and target TVs; report improvement relative to baseline `n0` (equal to demand).
- Core components:
  - Baseline inputs via `prepare_flow_scheduling_inputs` restricted to target TVs.
  - Objective evaluation via `parrhesia.optim.objective.score`.
  - Optimization via `parrhesia.optim.sa_optimizer.run_sa`.
  - Post‑optimization realized occupancy via `parrhesia.optim.occupancy.compute_occupancy`.

---

## Request JSON

Required keys:
- `flows` (object): Mapping `flow_id -> [flight_id, ...]`. Flow IDs may be strings or integers; they are deterministically coerced to integers. Unknown flight IDs are ignored.
- `targets` (object): Mapping `TV_ID -> {"from": "HH:MM[:SS]", "to": "HH:MM[:SS]"}`. The controlled volume for each flow is selected from this set only. Unknown TVs are ignored.

Optional keys:
- `ripples` (object): Same schema as `targets`. Defines a secondary attention region with different weights.
- `auto_ripple_time_bins` (int, default 0): If greater than 0, overrides `ripples`. Ripple cells are computed as the union of all TVs/bins touched by any flight in `flows`, dilated by ±`auto_ripple_time_bins` along time.
- `indexer_path` (string): Path to `tvtw_indexer.json`. If omitted, uses app‑level cached resources when available, else project defaults.
- `flights_path` (string): Path to `so6_occupancy_matrix_with_times.json`. Same precedence as above.
- `capacities_path` (string): Path to capacities GeoJSON. If omitted, attempts to use app‑level cached capacity matrix; else falls back to defaults.
- `weights` (object): Partial overrides for `ObjectiveWeights` (e.g., `{ "alpha_gt": 10.0, "lambda_delay": 0.1 }`).
- `sa_params` (object): Partial overrides for `SAParams`:
  - `iterations` (int, default 1000): Number of SA iterations.
  - `warmup_moves` (int, default 50): Trial moves to estimate initial temperature.
  - `alpha_T` (float, default 0.95): Temperature decay factor per `L` iterations.
  - `L` (int, default 50): Temperature update period.
  - `seed` (int|null, default 0): RNG seed; controls determinism.
  - `attention_bias` (float in [0,1], default 0.8): Probability a move samples from target/ripple‑classified bins.
  - `max_shift` (int, default 4): Max Δ for shift‑later move.
  - `pull_max` (int, default 2): Max Δ for pull‑forward move.
  - `smooth_window_max` (int, default 3): Max window for smoothing move.

Validation (HTTP 400):
- `flows` missing/not an object
- `targets` missing/empty
- Malformed time windows in `targets`/`ripples` (must be `HH:MM` or `HH:MM:SS`)
- Non‑integer `auto_ripple_time_bins`
- Invalid `sa_params` field types

Graceful ignoring:
- Unknown TVs in `targets`/`ripples` are dropped.
- Unknown flight IDs in `flows` are ignored.

---

## Response JSON (200 OK)

Top‑level fields:
- `num_time_bins` (int): Number of bins in the day.
- `tvs` (string[]): The target TV IDs considered for control.
- `target_cells` (Array<[string, int]>): Explicit (tv, bin) pairs from `targets`.
- `ripple_cells` (Array<[string, int]>): Explicit (tv, bin) pairs from `ripples` or auto‑ripple.
- `flows` (FlowOpt[]): List of per‑flow results (see below).
- `objective_baseline` (object): `{ "score": number, "components": {...} }` at baseline `n0`.
- `objective_optimized` (object): `{ "score": number, "components": {...} }` at optimized `n_opt`.
- `improvement` (object): `{ "absolute": number, "percent": number }` where `absolute = baseline - optimized`.
- `weights_used` (object): Effective `ObjectiveWeights` after overrides.
- `sa_params_used` (object): Effective `SAParams` used in optimization.

FlowOpt object:
- `flow_id` (int)
- `controlled_volume` (string|null): Selected controlled TV for this flow.
- `n0` (int[]): Baseline schedule (counts per requested bin), length `T+1` (includes overflow at index `T`).
- `demand` (int[]): Baseline demand (length `T`), i.e., `n0` without overflow.
- `n_opt` (int[]): Optimized schedule, length `T+1`.
- `target_demands` (object): `TV_ID -> int[]` (length `T`) giving earliest‑crossing demand per target TV.
- `ripple_demands` (object): `TV_ID -> int[]` (length `T`) giving earliest‑crossing demand per ripple TV.
- `target_occupancy_opt` (object): `TV_ID -> int[]` (length `T`) realized occupancy under `n_opt` for target TVs.
- `ripple_occupancy_opt` (object): Same for ripple TVs.

Notes:
- “Demands” are earliest crossings (baseline), whereas “occupancy_opt” reflects realized occupancy after per‑flight delays induced by `n_opt`.
- Arrays are JSON‑friendly (numpy arrays converted to lists).

---

## Example: Minimal Request

```bash
curl -X POST http://localhost:8000/automatic_rate_adjustment \
  -H 'Content-Type: application/json' \
  -d '{
    "flows": {"0": ["FL1", "FL2"], "1": ["FL3"]},
    "targets": {"TV_A": {"from": "08:00", "to": "09:00"}},
    "ripples": {"TV_B": {"from": "08:00", "to": "10:00"}},
    "weights": {"alpha_gt": 10.0, "lambda_delay": 0.1},
    "sa_params": {"iterations": 300, "seed": 0, "attention_bias": 0.8}
  }'
```

Example truncated response:

```json
{
  "num_time_bins": 48,
  "tvs": ["TV_A"],
  "target_cells": [["TV_A", 16], ["TV_A", 17], ...],
  "ripple_cells": [["TV_B", 16], ["TV_B", 17], ...],
  "flows": [
    {
      "flow_id": 0,
      "controlled_volume": "TV_A",
      "n0": [0,0,0,0,1,0, ... ,0],
      "demand": [0,0,0,0,1,0, ...],
      "n_opt": [0,0,0,0,1,0, ... ,0],
      "target_demands": {"TV_A": [0,0,1,0,0, ...]},
      "ripple_demands": {"TV_B": [0,1,0,0,0, ...]},
      "target_occupancy_opt": {"TV_A": [0,0,1,0,0, ...]},
      "ripple_occupancy_opt": {"TV_B": [0,1,0,0,0, ...]}
    }
  ],
  "objective_baseline": {"score": 9521.1, "components": {"J_cap": 9000.5, "J_delay": 480.0, "J_reg": 32.6, "J_tv": 8.0}},
  "objective_optimized": {"score": 9215.4, "components": {"J_cap": 8705.9, "J_delay": 440.0, "J_reg": 61.5, "J_tv": 8.0}},
  "improvement": {"absolute": 305.7, "percent": 3.21},
  "weights_used": {"alpha_gt": 10.0, "alpha_rip": 3.0, "alpha_ctx": 0.5, ...},
  "sa_params_used": {"iterations": 300, "warmup_moves": 50, "alpha_T": 0.95, "L": 50, "seed": 0, ...}
}
```

---

## Practical Usage Tips

- Targets vs ripples:
  - Put your primary concern windows in `targets`; the controlled volume for each flow is selected among these TVs.
  - Use `ripples` to soften penalties near the target zones without ignoring them.
  - For exploratory runs, `auto_ripple_time_bins: 2..4` can automatically capture spillover windows.

- Weights:
  - `alpha_*` scale capacity exceedance penalties; raising `alpha_gt` prioritizes eliminating hot‑spot overloads.
  - `lambda_delay` trades delay vs overload; larger values reduce delays but may accept more exceedance.
  - `beta_*` and `gamma_*` control adherence to demand and schedule smoothness.

- SA parameters:
  - `iterations`: increase for quality; SA is stochastic—use a fixed `seed` for repeatability.
  - `attention_bias`: values closer to 1.0 bias moves into bins classified as target/ripple (faster convergence towards the attention regions).

- Reading results:
  - `n0` vs `n_opt`: both length `T+1`. Compare distributions and overflow at index `T`.
  - `target_occupancy_opt` shows realized counts post‑optimization—compare to capacity externally if needed.
  - `objective_optimized.score` should be ≤ `objective_baseline.score`; if not, increase `iterations` or adjust weights.

---

## Troubleshooting

- 400 errors about inputs:
  - Ensure `flows` is an object (`{"0": ["FL1", ...]}`) and `targets` has valid time strings.
  - `auto_ripple_time_bins` must be integer ≥ 0.

- Missing TVs or flights:
  - Unknown TVs in `targets`/`ripples` are ignored; verify IDs match the dataset.
  - Flight IDs not present in the dataset are skipped; confirm your IDs.

- Capacities:
  - If the app is running with cached resources, capacities are taken from the in‑memory matrix; otherwise ensure `capacities_path` points to a valid GeoJSON.

---

## Python Example (async client)

```python
import httpx

payload = {
    "flows": {"0": ["FL1", "FL2"], "1": ["FL3"]},
    "targets": {"TV_A": {"from": "08:00", "to": "09:00"}},
    "auto_ripple_time_bins": 2,
    "weights": {"alpha_gt": 10.0, "lambda_delay": 0.1},
    "sa_params": {"iterations": 300, "seed": 0}
}

async def run():
    async with httpx.AsyncClient() as client:
        r = await client.post("http://localhost:8000/automatic_rate_adjustment", json=payload)
        r.raise_for_status()
        data = r.json()
        print("Improvement:", data["improvement"])  # {'absolute': ..., 'percent': ...}
```

---

## Implementation Notes (for developers)

- Artifacts load precedence: explicit paths → app‑level cached resources → default files under `data/`.
- Controlled volume and requested bins are produced by `prepare_flow_scheduling_inputs` restricted to target TVs.
- Optimizer: `run_sa` evaluates candidates using `score_with_context`; attention masks are derived from beta/gamma classifications keyed on target/ripple cells.
- Post‑optimization occupancy is computed on a reduced subset (per flow) for `target_occupancy_opt` and `ripple_occupancy_opt`.

