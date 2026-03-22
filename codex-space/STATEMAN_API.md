# Mid-Regulation State History Management API

This document explains how Tailwind manages delayed-flight state across multiple regulation episodes for a single active resource date.

The goal is to let clients:
- start from the loaded no-delay baseline
- commit concrete regulation outcomes as exact `flight_id -> delay_minutes` episodes
- inspect the full linear history
- navigate back to any prior state
- run all existing demand-oriented APIs against the currently selected delayed-flight state

---

## Why This Exists

Tailwind used to expose a single active resource context for a selected date. That was not enough for multi-episode regulation workflows because:
- the client needs to preserve prior regulation outcomes
- later proposals must build on the already delayed flight list
- analysts need to move backward and forward in history without corrupting state
- all APIs must remain internally consistent for whichever delayed-flight state is currently selected

The state-history layer solves this by introducing a linear, in-memory sequence of resource states on top of the active date.

---

## Core Model

For the currently active resource date:

- `state-0000` is always the baseline loaded from disk.
- `state-0000` means no committed regulations and no committed delay episodes.
- every later state is one committed regulation episode
- each episode stores a concrete incremental delay map:
  - `flight_id -> delayed minutes`
- each state also stores a cumulative delay map:
  - total delay per flight after replaying all episodes up to that state

The history is linear, not branching:
- you may select an old state to inspect it
- but new commits are only allowed from the current head state

That rule is intentional. It prevents ambiguous forks and avoids mixing incompatible flight-list states together.

---

## State Semantics

For a given state:

- the `flight_list` reflects all cumulative delays up to that state
- the `sector_flight_list` reflects the same cumulative delays
- `flight_level_intervals_by_flight` is shifted by the exact same delay in seconds
- all demand/count/hotspot/regulation APIs operate on that selected delayed state

Delay application is exact within the API contract:
- the API accepts integer minutes
- Tailwind applies `delay_minutes * 60` seconds exactly
- there is no additional approximation introduced by the state-history feature

Existing count semantics are unchanged:
- binning remains whatever the existing endpoint already uses
- this feature only changes which delayed flight state those endpoints read

---

## Memory Model

This feature is memory-bounded by design.

Tailwind does not keep a fully materialized copy of every historical state in memory.

Instead it keeps:
- the active date's baseline resources (`state-0000`)
- the currently selected materialized state
- the ordered list of state records and delay maps

When the client selects an older state:
- Tailwind clones `state-0000`
- replays delay episodes up to the requested state
- materializes only that selected state

This gives bounded memory growth while preserving correctness.

---

## Global Selection Model

The server still has a single active resource date at a time, and now also a single active resource state for that date.

That means:
- `POST /resource_context/select` changes the active date
- changing the active date resets history to a fresh `state-0000`
- `POST /resource_state/select` changes the active delayed-flight state for the active date

All subsequent API requests use the selected state unless another selection is made.

Responses from state-aware endpoints include:
- `X-Resource-Date`
- `X-Resource-State-ID`

These headers help clients verify that they are looking at results from the intended state.

---

## Correctness Guarantee Across Existing APIs

The important rule is:

All demand-oriented APIs operate on the currently selected resource state.

That includes, but is not limited to:
- counts and occupancy endpoints
- hotspot detection
- flow extraction
- regulation proposal
- flight-level count endpoints
- reroute impact calculations
- pre/post occupancy analysis
- `/autorate_occupancy`
- `/base_evaluation`
- `/automatic_rate_adjustment`

This is implemented centrally through request-local resource binding rather than by adding a `state_id` argument to every endpoint. The purpose is to minimize invasive API patching while keeping results internally consistent for each request.

---

## State Lifecycle

### 1. Select a date

The user selects a resource date:

```http
POST /resource_context/select
Content-Type: application/json

{
  "date": "2023-07-18"
}
```

Result:
- Tailwind loads that date's artifacts
- Tailwind creates a fresh `state-0000`
- `state-0000` becomes both the selected state and the head state

### 2. Run analysis on the baseline

The client can call any existing API and will get baseline results for `state-0000`.

### 3. Commit a regulation episode

When a regulation has been decided and concrete delays are known, the client commits them:

```http
POST /resource_state_history_commit
Content-Type: application/json

{
  "parent_state_id": "state-0000",
  "label": "Morning hotspot mitigation",
  "metadata": {
    "source": "regen",
    "traffic_volume_id": "MASB5KL",
    "time_window": "09:00-10:15"
  },
  "delays_min": {
    "FLIGHT_001": 12,
    "FLIGHT_002": 7,
    "FLIGHT_003": 15
  }
}
```

Result:
- Tailwind applies those delays exactly
- creates `state-0001`
- auto-selects `state-0001`
- makes `state-0001` the new head

### 4. Run more analysis on the delayed state

Now all existing endpoints run against the delayed flight state represented by `state-0001`.

### 5. Commit later episodes

If another regulation is added later, commit again from the current head:

```http
POST /resource_state_history_commit
Content-Type: application/json

{
  "parent_state_id": "state-0001",
  "label": "Second wave mitigation",
  "metadata": {
    "source": "manual_review"
  },
  "delays_min": {
    "FLIGHT_004": 10,
    "FLIGHT_002": 5
  }
}
```

This creates `state-0002`.

### 6. Navigate old states

If the client wants to inspect the first regulation outcome again:

```http
POST /resource_state/select
Content-Type: application/json

{
  "state_id": "state-0001"
}
```

Now all subsequent APIs operate on `state-0001` until the client selects another state.

---

## API Summary

### `GET /resource_context`

Returns the active resource date plus a compact state-history summary.

Important fields:
- `selected_date`
- `available_dates`
- `selected_state_id`
- `head_state_id`
- `state_zero_id`
- `num_states`
- `state_history_generation`
- `states`

Example response:

```json
{
  "selected_date": "2023-07-18",
  "available_dates": ["2023-07-18", "2023-07-19"],
  "selected_state_id": "state-0002",
  "head_state_id": "state-0002",
  "state_zero_id": "state-0000",
  "num_states": 3,
  "state_history_generation": 4,
  "states": [
    {
      "state_id": "state-0000",
      "parent_state_id": null,
      "episode_index": 0,
      "label": "State Zero",
      "num_affected_flights": 0,
      "num_delayed_flights": 0,
      "total_incremental_delay_minutes": 0,
      "total_cumulative_delay_minutes": 0,
      "is_selected": false,
      "is_head": false,
      "is_state_zero": true
    },
    {
      "state_id": "state-0001",
      "parent_state_id": "state-0000",
      "episode_index": 1,
      "label": "Morning hotspot mitigation",
      "num_affected_flights": 3,
      "num_delayed_flights": 3,
      "total_incremental_delay_minutes": 34,
      "total_cumulative_delay_minutes": 34,
      "is_selected": false,
      "is_head": false,
      "is_state_zero": false
    },
    {
      "state_id": "state-0002",
      "parent_state_id": "state-0001",
      "episode_index": 2,
      "label": "Second wave mitigation",
      "num_affected_flights": 2,
      "num_delayed_flights": 4,
      "total_incremental_delay_minutes": 15,
      "total_cumulative_delay_minutes": 49,
      "is_selected": true,
      "is_head": true,
      "is_state_zero": false
    }
  ]
}
```

### `POST /resource_context/select`

Switch the active resource date and reset history.

Request:

```json
{
  "date": "2023-07-18"
}
```

Behavior:
- loads the date's artifacts
- resets history
- creates a fresh `state-0000`

### `GET /resource_state_history`

Returns the full ordered history for the active date, including full incremental and cumulative delay maps.

Example response:

```json
{
  "resource_date": "2023-07-18",
  "state_zero_id": "state-0000",
  "selected_state_id": "state-0002",
  "head_state_id": "state-0002",
  "num_states": 3,
  "state_history_generation": 4,
  "states": [
    {
      "state_id": "state-0002",
      "parent_state_id": "state-0001",
      "episode_index": 2,
      "created_at": "2026-03-20T03:20:00+00:00",
      "resource_date": "2023-07-18",
      "label": "Second wave mitigation",
      "metadata": {
        "source": "manual_review"
      },
      "incremental_delays_min": {
        "FLIGHT_004": 10,
        "FLIGHT_002": 5
      },
      "cumulative_delays_min": {
        "FLIGHT_001": 12,
        "FLIGHT_002": 12,
        "FLIGHT_003": 15,
        "FLIGHT_004": 10
      },
      "num_affected_flights": 2,
      "num_delayed_flights": 4,
      "total_incremental_delay_minutes": 15,
      "total_cumulative_delay_minutes": 49,
      "is_selected": true,
      "is_head": true,
      "is_state_zero": false
    }
  ]
}
```

### `POST /resource_state/select`

Select any existing state in history.

Request:

```json
{
  "state_id": "state-0001"
}
```

Behavior:
- rebuilds the requested state from `state-0000` plus replay
- makes it the selected state for future requests
- does not create a new state

Success response:

```json
{
  "selected_date": "2023-07-18",
  "selected_state_id": "state-0001",
  "head_state_id": "state-0002",
  "state_zero_id": "state-0000",
  "num_states": 3,
  "state_history_generation": 6,
  "states": [
    {
      "state_id": "state-0000",
      "is_selected": false,
      "is_head": false,
      "is_state_zero": true
    },
    {
      "state_id": "state-0001",
      "is_selected": true,
      "is_head": false,
      "is_state_zero": false
    },
    {
      "state_id": "state-0002",
      "is_selected": false,
      "is_head": true,
      "is_state_zero": false
    }
  ],
  "status": "active",
  "state": {
    "state_id": "state-0001",
    "parent_state_id": "state-0000",
    "episode_index": 1,
    "label": "Morning hotspot mitigation",
    "incremental_delays_min": {
      "FLIGHT_001": 12,
      "FLIGHT_002": 7
    },
    "cumulative_delays_min": {
      "FLIGHT_001": 12,
      "FLIGHT_002": 7
    }
  },
  "resource_context": {
    "selected_date": "2023-07-18",
    "selected_state_id": "state-0001",
    "head_state_id": "state-0002",
    "state_zero_id": "state-0000",
    "num_states": 3,
    "state_history_generation": 6
  }
}
```

Common errors:
- `404` for unknown `state_id`
- `400` for malformed JSON or empty `state_id`

### `POST /resource_state_history_commit`

Append a new regulation episode to the current head.

Request:

```json
{
  "parent_state_id": "state-0002",
  "label": "Evening balancing action",
  "metadata": {
    "source": "operator",
    "note": "manual follow-up after hotspot review"
  },
  "delays_min": {
    "FLIGHT_010": 8,
    "FLIGHT_011": 11
  }
}
```

Validation rules:
- `parent_state_id` must be non-empty
- `delays_min` must be an object
- delay values must be integers
- delay values must be non-negative
- at least one positive delay must be present
- all flight IDs must exist in the active `flight_list`
- all flight IDs must exist in the active `sector_flight_list`
- if `flight_level_intervals_by_flight` is available, all flight IDs must exist there too
- the selected state must be the head
- `parent_state_id` must equal the current head

Success response:

```json
{
  "status": "active",
  "state": {
    "state_id": "state-0003",
    "parent_state_id": "state-0002",
    "episode_index": 3,
    "created_at": "2026-03-20T04:00:00+00:00",
    "resource_date": "2023-07-18",
    "label": "Evening balancing action",
    "metadata": {
      "source": "operator",
      "note": "manual follow-up after hotspot review"
    },
    "incremental_delays_min": {
      "FLIGHT_010": 8,
      "FLIGHT_011": 11
    },
    "cumulative_delays_min": {
      "FLIGHT_001": 12,
      "FLIGHT_002": 12,
      "FLIGHT_003": 15,
      "FLIGHT_004": 10,
      "FLIGHT_010": 8,
      "FLIGHT_011": 11
    }
  },
  "resource_context": {
    "selected_state_id": "state-0003",
    "head_state_id": "state-0003"
  }
}
```

Conflict response example:

```json
{
  "detail": "State 'state-0001' is not the current head 'state-0003'; linear history only allows commits from the head"
}
```

This returns HTTP `409`.

---

## Usage Examples

### Example 1: Basic baseline to one regulation

1. Select a date:

```bash
curl -X POST http://localhost:8000/resource_context/select \
  -H 'Content-Type: application/json' \
  -d '{"date":"2023-07-18"}'
```

2. Inspect the baseline state:

```bash
curl http://localhost:8000/resource_context
```

3. Run baseline counts:

```bash
curl -X POST http://localhost:8000/original_counts \
  -H 'Content-Type: application/json' \
  -d '{}'
```

4. Commit a regulation episode:

```bash
curl -X POST http://localhost:8000/resource_state_history_commit \
  -H 'Content-Type: application/json' \
  -d '{
    "parent_state_id":"state-0000",
    "label":"Morning mitigation",
    "delays_min":{
      "FLIGHT_001":12,
      "FLIGHT_002":7
    }
  }'
```

5. Run the same counts endpoint again:

```bash
curl -X POST http://localhost:8000/original_counts \
  -H 'Content-Type: application/json' \
  -d '{}'
```

The second result is now computed on `state-0001`.

### Example 2: Navigate back in history

Inspect all states:

```bash
curl http://localhost:8000/resource_state_history
```

Select a prior state:

```bash
curl -X POST http://localhost:8000/resource_state/select \
  -H 'Content-Type: application/json' \
  -d '{"state_id":"state-0001"}'
```

Now run hotspot detection or proposal generation:

```bash
curl -X POST http://localhost:8000/propose_regulations \
  -H 'Content-Type: application/json' \
  -d '{
    "traffic_volume_id":"MASB5KL",
    "time_window":"09:00-10:15"
  }'
```

This proposal is now computed from `state-0001`, not from the current head unless `state-0001` is also the head.

### Example 3: Committing from stale state is rejected

Suppose the head is `state-0003`, but the client tries to commit from `state-0001`:

```bash
curl -X POST http://localhost:8000/resource_state_history_commit \
  -H 'Content-Type: application/json' \
  -d '{
    "parent_state_id":"state-0001",
    "delays_min":{
      "FLIGHT_020":5
    }
  }'
```

This returns HTTP `409` because history is linear and only the head can be extended.

### Example 4: Full workflow with optimization endpoints

1. Select date
2. Commit one or more regulation episodes
3. Call `/base_evaluation`
4. Call `/automatic_rate_adjustment`
5. Save the returned `delays_min`
6. If those optimized delays are accepted operationally, commit them as the next episode with `/resource_state_history_commit`

That pattern gives a clean chain of:
- selected state
- analysis
- accepted action
- committed next state

---

## Client Recommendations

- Always call `GET /resource_context` before major operations if you need to verify the active date/state.
- Read `X-Resource-Date` and `X-Resource-State-ID` from responses when possible.
- Treat `state_id` as authoritative, not inferred list position.
- Include useful `metadata` on commits so history remains explainable.
- If you navigate to an old state for analysis, explicitly re-select the head before committing a new episode.

---

## Operational Constraints

- History is in-memory only.
- Server restart clears the state history.
- Changing the active date clears the old date's history and creates a fresh `state-0000`.
- There is no branching history in this version.
- Delay precision is exact to integer minutes because that is the API contract.

---

## Practical Interpretation

Think of the feature as a flight-state timeline:

- select date
- baseline state appears as `state-0000`
- each accepted regulation outcome becomes one new state
- all APIs read from whichever state is currently selected
- older states remain available for replay and inspection

This lets Tailwind support multi-episode planning without requiring every existing endpoint to accept an explicit `state_id` parameter.
