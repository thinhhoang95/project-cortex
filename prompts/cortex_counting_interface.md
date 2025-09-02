Can you help me plan in details for a **traffic counting page**: a component and a endpoint to access it.

# Look and Feel

Please refer to the `RegulationResults.tsx` dialog to copy the color scheme, the look-n-feel of the page. Unlike `RegulationResults`, `TrafficCount` will not be a dialog, but a full web-page that is supposed to be opened in a new tab.

# UI Design Instructions

### Page Parameters

The following information will be inferred from the URL params:

1. A JSON-ified string encoding the flow and flight list targeted for regulations for `categories`:
    ```json
    [
        {
            "flow_name": "Flow 1",
            "from_time": "08:00:00",
            "to_time": "08:45:00",
            "flight_list": [
                "265316680", "265316681", ...
            ]
        },
        {
            "flow_name": "Flow 2",
            "from_time": "08:23:30",
            "to_time": "08:56:15",
            "flight_list": [...]
        }
    ]
    ```

2. **Or,** 

# Reference API

## Endpoint

- Method: POST
- Path: `/original_counts`
- Content-Type: `application/json`
- Auth: none

---

## Request Body

- `traffic_volume_ids` (list[string], required):
  - Set of TV identifiers to return counts for. All must be known by the server (404 on any unknown ID).

- `from_time_str` (string, optional) and `to_time_str` (string, optional):
  - Accepts formats: `HHMM`, `HHMMSS`, `HH:MM`, `HH:MM:SS`.
  - If one is provided, the other is required; otherwise the full day is returned.
  - Time strings map to inclusive bin indices via: `bin = floor(seconds / (time_bin_minutes * 60))`, then clamped to `[0, num_bins_per_tv - 1]`.
  - `to_time_str` must be at least `from_time_str` (no wrap-around in this version); otherwise 400.

- `categories` (object, optional):
  - A mapping `{ category_id: [flight_id, ...] }`.
  - For each category, counts are computed only over the specified flights.
  - Unknown flight IDs are ignored and returned in `metadata.missing_flight_ids`.

- `include_overall` (boolean, default true):
  - Whether to include overall counts (across all flights) in `counts`.

- `flight_ids` (list[string], optional):
  - When provided and `categories` is absent, only these flights are admitted to the counting process (acts as a filter).
  - Unknown flight IDs are ignored and returned in `metadata.missing_flight_ids`.
  - Ignored if `categories` is present.

---

## Response Body

- `time_bin_minutes` (int): Size of each time bin in minutes (e.g., 15).
- `timebins` (object):
  - `start_bin` (int): First returned bin index within a TV.
  - `end_bin` (int): Last returned bin index within a TV (inclusive).
  - `labels` (list[string]): Human-readable window labels for each returned bin, formatted `HH:MM-HH:MM`.
- `counts` (object, optional): `{ tv_id: [int, ...] }` overall counts per bin; present when `include_overall` is true.
- `by_category` (object, optional): `{ category_id: { tv_id: [int, ...] } }` per-category counts per bin.
- `metadata` (object):
  - `num_tvs` (int): Number of TVs in the request.
  - `num_bins` (int): Number of bins returned (`end_bin - start_bin + 1`).
  - `total_flights_considered` (int): Total unique flights considered; if categories are provided, counts flights in the union of all category lists, else all flights.
  - `missing_flight_ids` (list[string], optional): Any unknown flight IDs encountered in `categories`.

Notes
- The binning and number of time bins per TV derive from the preloaded TVTW indexer (`time_bin_minutes`).
- When `include_overall` is false, `counts` is omitted and only `by_category` is returned (if provided).

---

## Examples

### 1) Full day, two TVs

Request
```json
{
  "traffic_volume_ids": ["TV_A", "TV_B"]
}
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
    "TV_A": [4, 7, 12, "..."],
    "TV_B": [1, 3, 5, "..."]
  },
  "metadata": {
    "num_tvs": 2,
    "num_bins": 96,
    "total_flights_considered": 12345
  }
}
```

### 2) Time window only

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
    "TV_A": [8, 11, 9, 12, 10, 7, 6]
  },
  "metadata": {
    "num_tvs": 1,
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
    "TV_A": [8, 11, 9, 12, 10, 7, 6]
  },
  "by_category": {
    "flow_1": { "TV_A": [3, 5, 4, 6, 5, 3, 2] },
    "flow_2": { "TV_A": [2, 2, 1, 3, 2, 2, 1] }
  },
  "metadata": {
    "num_tvs": 1,
    "num_bins": 7,
    "total_flights_considered": 5,
    "missing_flight_ids": []
  }
}
```

### 4) Without overall counts

Request
```json
{
  "traffic_volume_ids": ["TV_A"],
  "include_overall": false,
  "categories": {"flow_1": ["F001", "F002"]}
}
```

Response (only `by_category` present)
```json
{
  "time_bin_minutes": 15,
  "timebins": { "start_bin": 0, "end_bin": 95, "labels": ["..."] },
  "by_category": { "flow_1": { "TV_A": ["..."] } },
  "metadata": { "num_tvs": 1, "num_bins": 96, "total_flights_considered": 2 }
}
```

### 5) Filter by explicit flight list (no categories)

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
    "TV_B": [0, 1, 1, 0, 0]
  },
  "metadata": {
    "num_tvs": 2,
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
  - Any unknown `traffic_volume_ids`.

- 500 Internal Server Error:
  - Unexpected server-side failures.

Example error response
```json
{
  "detail": "Unknown traffic_volume_ids: [\"TV_UNKNOWN\"]"
}
```

---

## Implementation Notes

- The server loads `FlightList` once at startup from:
  - `output/so6_occupancy_matrix_with_times.json`
  - `output/tvtw_indexer.json`
- Overall counts reuse a cached total occupancy vector for performance.
- Category counts sum over the selected flight rows of the sparse occupancy matrix, sliced by TV and time range.
- Time labels are generated purely from `time_bin_minutes` and bin indices.
