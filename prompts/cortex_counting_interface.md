Can you help me plan in details for a **traffic counting page**: a component and a endpoint to access it. The dedicated URL for this will be `/original_count`.

# Look and Feel

Please refer to the `RegulationResults.tsx` dialog to copy the color scheme, the look-n-feel of the page. Unlike `RegulationResults`, `TrafficCount` will not be a dialog, but a full web-page that is supposed to be opened in a new tab.

# UI Design Instructions

On the top there is a clear title of the page: `Occupancy Counts`.

Then below that, there is a set of controls:

1. A Multi Select with Chips for Traffic Volumes, similar to the one you see in `FlowRegulationPanel.tsx`.

2. Two controls to select the From time and End time. Default to 00:00 to 23:59.

3. A switch to toggle `Rolling Hour` On or Off.

3. A Query button which will make an API call when clicked on (see the API reference down below).

Then there is the next section: `Mentioned Traffic Volumes`. For each traffic volumes, show the histogram for each (please handle accordingly if the field is unavailable). There should be 5 columns maximum, beneath each histogram, show the label for the traffic volume.

Then there is the next section: `Top Traffic Volumes`, similarly but with `top_k` traffic volumes.

# Functionalities

1. Create a route.tsx for the `original_counts` API endpoint.

2. Query the API with empty category, empty flight ID (don't mention these at all in the query JSON), 

# Pitfalls

- Make sure the hovering info legend box floats with high-z to make sure they stay on top of everything.

# API Docs
# Original Counts API

Endpoint for computing traffic-volume occupancy counts over the day, optionally restricted to a time window and/or broken down by user-supplied categories (e.g., flows). The server holds a single in‑memory FlightList, so requests reuse loaded data without re-reading large JSON files.

---

## Endpoint

- Method: POST
- Path: `/original_counts`
- Content-Type: `application/json`
- Auth: none

---

## Request Body

- `traffic_volume_ids` (list[string], optional):
  - If provided, a dedicated `mentioned_counts` section will be returned for these TVs. All must be known (404 on any unknown ID).

- `from_time_str` (string, optional) and `to_time_str` (string, optional):
  - Accepts formats: `HHMM`, `HHMMSS`, `HH:MM`, `HH:MM:SS`.
  - If one is provided, the other is required; otherwise the full day is returned.
  - Time strings map to inclusive bin indices via: `bin = floor(seconds / (time_bin_minutes * 60))`, then clamped to `[0, num_bins_per_tv - 1]`.
  - `to_time_str` must be at least `from_time_str` (no wrap-around in this version); otherwise 400.

- `categories` (object, optional):
  - A mapping `{ category_id: [flight_id, ...] }`.
  - For each category, counts are computed only over the specified flights.
  - Unknown flight IDs are ignored and returned in `metadata.missing_flight_ids`.

- `flight_ids` (list[string], optional):
  - When provided and `categories` is absent, only these flights are admitted to the counting process (acts as a filter).
  - Unknown flight IDs are ignored and returned in `metadata.missing_flight_ids`.
  - Ignored if `categories` is present.

- `rank_by` (string, optional; default `"total_count"`):
  - Ranks traffic volumes by total count over the selected time range.

- `rolling_hour` (boolean, optional; default `true`):
  - When true, each bin’s count is the sum over the next hour from that bin (non-wrapping).

- `include_overall` (boolean, optional):
  - Accepted for backward compatibility; the endpoint always returns `counts` for the ranked top‑50 TVs.

---

## Response Body

- `time_bin_minutes` (int): Size of each time bin in minutes (e.g., 15).
- `timebins` (object):
  - `start_bin` (int): First returned bin index within a TV.
  - `end_bin` (int): Last returned bin index within a TV (inclusive).
  - `labels` (list[string]): Human-readable window labels for each returned bin, formatted `HH:MM-HH:MM`.
- `counts` (object): `{ tv_id: [int, ...] }` counts per bin for the ranked top‑50 TVs (ranking may include TVs not in `traffic_volume_ids`).
- `mentioned_counts` (object, optional): `{ tv_id: [int, ...] }` counts per bin for TVs explicitly provided in `traffic_volume_ids` (if any). These TVs can also appear in `counts`.
- `by_category` (object, optional): `{ category_id: { tv_id: [int, ...] } }` per-category counts per bin for the same set of TVs as in `counts` (top‑50).
- `by_category_mentioned` (object, optional): present when `traffic_volume_ids` are provided; `{ category_id: { tv_id: [int, ...] } }` per-category counts per bin for only the mentioned TVs.
- `metadata` (object):
  - `num_tvs` (int): Number of TVs included in `counts` (typically 50).
  - `num_mentioned` (int, optional): Number of TVs included in `mentioned_counts` when `traffic_volume_ids` is provided.
  - `num_bins` (int): Number of bins returned (`end_bin - start_bin + 1`).
  - `total_flights_considered` (int): Total unique flights considered; if categories are provided, counts flights in the union of all category lists, else all flights.
  - `rank_by` (string): Ranking criterion used.
  - `top_k` (int): Fixed at 50.
  - `rolling_hour` (boolean): Whether rolling-hour accumulation was applied.
  - `rolling_window_minutes` (int): Rolling window size in minutes (60).
  - `ranked_tv_ids` (list[string]): TV IDs in ranked order matching the keys in `counts`.
  - `missing_flight_ids` (list[string], optional): Any unknown flight IDs encountered in `categories` or `flight_ids`.

Notes
- The binning and number of time bins per TV derive from the preloaded TVTW indexer (`time_bin_minutes`).
- When `include_overall` is false, `counts` is omitted and only `by_category` is returned (if provided).

---

## Examples

### 1) Full day, no requested TVs (top‑50 returned)

Request
```json
{}
```

Response (truncated)
```json
{
  "time_bin_minutes": 15,
  "timebins": {
    "start_bin": 0,
    "end_bin": 95,
    "labels": ["00:00-00:15", "00:15-00:30", "..."]
  },
  "counts": {
    "TV_123": [4, 7, 12, "..."],
    "TV_456": [3, 5, 9, "..."],
    "...": ["..."]
  },
  "metadata": {
    "num_tvs": 50,
    "num_bins": 96,
    "total_flights_considered": 12345,
    "rank_by": "total_count",
    "top_k": 50,
    "rolling_hour": true,
    "rolling_window_minutes": 60,
    "ranked_tv_ids": ["TV_123", "TV_456", "..."]
  }
}
```

### 2) Time window with requested TVs and mentioned_counts

Request
```json
{
  "traffic_volume_ids": ["TV_A"],
  "from_time_str": "06:00",
  "to_time_str": "07:30"
}
```

Response (bins 06:00–07:30 → N=7 for 15-min bins)
```json
{
  "time_bin_minutes": 15,
  "timebins": {
    "start_bin": 24,
    "end_bin": 30,
    "labels": [
      "06:00-06:15", "06:15-06:30", "06:30-06:45",
      "06:45-07:00", "07:00-07:15", "07:15-07:30", "07:15-07:30"
    ]
  },
  "counts": {
    "TV_A": [8, 11, 9, 12, 10, 7, 6],
    "TV_X": [7, 9, 8, 11, 9, 6, 5],
    "...": ["..."]
  },
  "mentioned_counts": {
    "TV_A": [8, 11, 9, 12, 10, 7, 6]
  },
  "metadata": {
    "num_tvs": 50,
    "num_mentioned": 1,
    "num_bins": 7,
    "total_flights_considered": 12345
  }
}
```

### 3) Time window with categories (flows)

Request
```json
{
  "traffic_volume_ids": ["TV_A"],
  "from_time_str": "06:00",
  "to_time_str": "07:30",
  "categories": {
    "flow_1": ["F001", "F002", "F003"],
    "flow_2": ["F010", "F011"]
  }
}
```

Response (truncated)
```json
{
  "time_bin_minutes": 15,
  "timebins": {
    "start_bin": 24,
    "end_bin": 30,
    "labels": ["06:00-06:15", "06:15-06:30", "..."]
  },
  "counts": {
    "TV_A": [8, 11, 9, 12, 10, 7, 6],
    "TV_B": [4, 6, 5, 7, 6, 4, 3],
    "...": ["..."]
  },
  "by_category": {
    "flow_1": { "TV_A": [3, 5, 4, 6, 5, 3, 2], "TV_B": [2, 3, 3, 4, 3, 2, 1] },
    "flow_2": { "TV_A": [2, 2, 1, 3, 2, 2, 1], "TV_B": [1, 1, 1, 2, 1, 1, 1] }
  },
  "by_category_mentioned": {
    "flow_1": { "TV_A": [3, 5, 4, 6, 5, 3, 2] },
    "flow_2": { "TV_A": [2, 2, 1, 3, 2, 2, 1] }
  },
  "metadata": {
    "num_tvs": 50,
    "num_bins": 7,
    "total_flights_considered": 5,
    "missing_flight_ids": []
  }
}
```

### 4) Filter by explicit flight list (no categories)

Request
```json
{
  "traffic_volume_ids": ["TV_A", "TV_B"],
  "from_time_str": "08:00",
  "to_time_str": "09:00",
  "flight_ids": ["F001", "F010", "F999"]
}
```

Response (truncated; note `missing_flight_ids` for unknown entries)
```json
{
  "time_bin_minutes": 15,
  "timebins": { "start_bin": 32, "end_bin": 36, "labels": ["08:00-08:15", "..."] },
  "counts": {
    "TV_A": [1, 2, 1, 0, 0],
    "TV_B": [0, 1, 1, 0, 0],
    "...": ["..."]
  },
  "mentioned_counts": { "TV_A": [1, 2, 1, 0, 0], "TV_B": [0, 1, 1, 0, 0] },
  "metadata": {
    "num_tvs": 50,
    "num_mentioned": 2,
    "num_bins": 5,
    "total_flights_considered": 2,
    "missing_flight_ids": ["F999"]
  }
}
```

---

## Error Handling

- 400 Bad Request:
  - Only one of `from_time_str` / `to_time_str` provided.
  - Invalid time format or components.
  - `to_time_str` earlier than `from_time_str`.
  - Wrong data types (e.g., `traffic_volume_ids` not a list).

- 404 Not Found:
  - Any unknown `traffic_volume_ids` (when provided).

- 500 Internal Server Error:
  - Unexpected server-side failures.

Example error response
```json
{
  "detail": "Unknown traffic_volume_ids: [\"TV_UNKNOWN\"]"
}
```