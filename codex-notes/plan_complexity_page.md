# Complexity Page Plan


### Navigation
In Header.tsx, should appear under Dynamic RAD context menu. The current Dynamic RAD (rad-preview) page should be renamed as the "RAD Library".

### Design
Follows the same `src/app/page.tsx`: with a large map canvas, the panes with panels scrolling inside without nesting (see `src/app/rad-preview/page.tsx` for a one left pane and two right panes layout example). 

The Map Canvas and the Panels should be `cp` (copied) and renamed accordingly, to maintain independence from other components. This will help isolate the failures better.

### Functionalities
- The Map will only show in CS mode, it cannot be switched to TV mode (`ViewOptionsControl` should lock to CS mode only).
- Similar to AirspaceInfo.tsx component, clone this to `CSComplexityPanel.tsx` component, which will show the CS name, along with any ability to only show the flight lines pertaining to the collapsed sector, with the ability to select the Window Interest time like 1h, 2h, 4h... like AirspaceInfo.tsx.
- Use the API call `/collapsed_sector_dd_suite` to populate the complexity suite, and present the complexity suite accordingly in the panel. You can design the panel so that it feels intuitive, easy to use.
- Beneath the complexity components is a list of radioboxes (should be divided into two columns) to enable visualizing the complexity on the map from the trace API `/collapsed_sector_dd_trace`. At any time there could be only one component to be shown on the map. Ensure that the map state management is sound, like clearing the artifacts before reloading new ones to avoid stale data display/memory leaks
- Closing the panel will clear all the map artifacts (detailed below).

### Visualization Details
- The ViewOptionsControl altitude range should limit only to the relevant events shown on the map should it be altitude bounded.
- For `hd` (or heading change), use two small line segments (one with an arrow to indicate the direction) for each event: basically show heading in, heading out and where heading change took place. Please think deeply about how to realize this efficiently.
- For `sc` and `ac` show the points where the change tookplace with the label upright/downright arrow indicating the change: for example: (downright) 250->230.
- For conflict-like events, show the points and the label indicating the flight level (like FL320).
Beware that events with FL info is subjected to FL filtering by ViewOptionsControl as mentioned.


# API References
# RADISH Dynamic Density APIs

This document describes the collapsed-sector RADISH dynamic-density endpoints added to the FastAPI server.

Both endpoints operate on the currently active resource date and resource state. They do not take a `date` parameter. Use `GET /resource_context` and the resource-state endpoints if the client needs to inspect or switch the active date/state before requesting dynamic-density data.

The client selects:
- one collapsed sector via `collapsed_sector_id`
- one intraday time range via `time_range`

The server evaluates only the DD sample endpoints that fall inside that requested range.

---

## 1. Collapsed-Sector DD Suite

- Method: `GET`
- Path: `/collapsed_sector_dd_suite`

### Query Parameters

- `collapsed_sector_id` (string, required)
  - Collapsed-sector identifier from the loaded collapsed-sector artifacts.

- `time_range` (string, required)
  - Format: `HH:MM:SS-HH:MM:SS`
  - `HHMM`, `HHMMSS`, `HH:MM`, and `HH:MM:SS` are also accepted on each side.
  - No wrap-around is supported in v1.
  - Example: `07:00:00-07:25:00`

- `sample_seconds` (integer, optional, default `120`)
  - Positive DD sampling interval in seconds.
  - Returned snapshots are aligned to the DD sample grid, not arbitrarily interpolated to the exact request bounds.

### Response Shape

```json
{
  "collapsed_sector_id": "EGTTFIS",
  "date": "2023-07-16",
  "time_range": {
    "start": "07:00:00",
    "end": "07:25:00",
    "start_s": 25200,
    "end_s": 26700
  },
  "sample_seconds": 120,
  "snapshots": [
    {
      "sector_id": "EGTTFIS",
      "sample_end_s": 25200,
      "sample_end_time": "07:00:00",
      "window_start_s": 25080,
      "window_start_time": "06:58:00",
      "sample_seconds": 120,
      "td": 18,
      "hc": 4,
      "sc_groundspeed_proxy": 7,
      "ac_segment": 6,
      "md5_raw": 2,
      "md10_raw": 3,
      "cp25_proxy": 1,
      "cp40_proxy": 0,
      "cp70_proxy": 1,
      "segment_overlap_count": 14
    }
  ],
  "metadata": {
    "num_snapshots": 1,
    "component_semantics": {
      "td": "aircraft active in sector at sample endpoint",
      "hc": "flights with heading boundary event > threshold within sample window and sector dwell"
    },
    "proxy_fields": [
      "sc_groundspeed_proxy",
      "cp25_proxy",
      "cp40_proxy",
      "cp70_proxy"
    ],
    "config": {
      "sample_seconds": 120
    },
    "artifact_metadata": {
      "resource_date": "2023-07-16"
    }
  }
}
```

### Notes

- `snapshots` is a time series over the selected range.
- `sample_end_time` is the snapshot timestamp.
- `window_start_time` is the start of the DD lookback window used by `hc`, `sc_groundspeed_proxy`, and `ac_segment`.
- `segment_overlap_count` is a diagnostic counter, not a formal DD component.

---

## 2. Collapsed-Sector DD Trace

- Method: `GET`
- Path: `/collapsed_sector_dd_trace`

This endpoint explains why the DD component counts occurred. It returns the same snapshot grid, but each snapshot also carries metric-specific evidence records.

### Query Parameters

- `collapsed_sector_id` (string, required)
- `time_range` (string, required)
- `sample_seconds` (integer, optional, default `120`)

- `metrics` (string, optional, repeatable or comma-separated)
  - Restricts the trace output to a subset of supported metrics.
  - Supported values:
    - `td`
    - `hc`
    - `sc_groundspeed_proxy`
    - `ac_segment`
    - `md5_raw`
    - `md10_raw`
    - `cp25_proxy`
    - `cp40_proxy`
    - `cp70_proxy`
  - Examples:
    - `?metrics=hc&metrics=cp25_proxy`
    - `?metrics=hc,cp25_proxy`

- `max_records_per_metric` (integer, optional)
  - Non-negative cap applied independently to each metric envelope at each snapshot.
  - Counts are still computed on the full underlying contributor set.

### Response Shape

```json
{
  "collapsed_sector_id": "EGTTFIS",
  "date": "2023-07-16",
  "time_range": {
    "start": "07:00:00",
    "end": "07:25:00",
    "start_s": 25200,
    "end_s": 26700
  },
  "sample_seconds": 120,
  "requested_metrics": ["hc", "cp25_proxy"],
  "max_records_per_metric": 50,
  "snapshots": [
    {
      "sector_id": "EGTTFIS",
      "sample_end_s": 25200,
      "sample_end_time": "07:00:00",
      "window_start_s": 25080,
      "window_start_time": "06:58:00",
      "sample_seconds": 120,
      "counts": {
        "sector_id": "EGTTFIS",
        "sample_end_s": 25200,
        "td": 18,
        "hc": 4,
        "sc_groundspeed_proxy": 7,
        "ac_segment": 6,
        "md5_raw": 2,
        "md10_raw": 3,
        "cp25_proxy": 1,
        "cp40_proxy": 0,
        "cp70_proxy": 1,
        "segment_overlap_count": 14
      },
      "traces_by_metric": {
        "hc": {
          "metric_id": "hc",
          "count": 4,
          "count_unit": "flights",
          "contributing_flight_ids": ["263336699"],
          "total_record_count": 4,
          "returned_record_count": 4,
          "truncated": false,
          "records": [
            {
              "flight_id": "263336699",
              "event_time_s": 25178.0,
              "event_state": {
                "time_s": 25178.0,
                "lon": 0.123,
                "lat": 51.456,
                "alt_ft": 28100.0
              },
              "heading_before_deg": 22.0,
              "heading_after_deg": 55.0,
              "heading_delta_deg": 33.0
            }
          ]
        }
      },
      "metadata": {
        "requested_metrics": ["hc", "cp25_proxy"]
      }
    }
  ],
  "metadata": {
    "num_snapshots": 1,
    "component_semantics": {
      "cp25_proxy": "active aircraft in CPA conflict proxy with current lateral separation in [0, 25] NM"
    },
    "proxy_fields": [
      "sc_groundspeed_proxy",
      "cp25_proxy",
      "cp40_proxy",
      "cp70_proxy"
    ],
    "available_trace_metrics": [
      "td",
      "hc",
      "sc_groundspeed_proxy",
      "ac_segment",
      "md5_raw",
      "md10_raw",
      "cp25_proxy",
      "cp40_proxy",
      "cp70_proxy"
    ],
    "config": {
      "sample_seconds": 120
    },
    "artifact_metadata": {
      "resource_date": "2023-07-16"
    }
  }
}
```

### Trace Interpretation

- `td` returns active-flight records at the sample endpoint.
- `hc` returns heading-boundary events with event time and interpolated event state.
- `sc_groundspeed_proxy` returns speed-boundary events with event time and interpolated event state.
- `ac_segment` returns overlapping altitude-change segments with start, end, midpoint, and overlap timing.
- `md5_raw` / `md10_raw` return pair records for nearest-neighbor contributors.
- `cp25_proxy` / `cp40_proxy` / `cp70_proxy` return pair records with current state plus CPA state.

### Metric-Specific Trace Payloads

Every `snapshots[i].traces_by_metric[metric_id]` entry is a metric envelope with the same outer shape:

```json
{
  "metric_id": "hc",
  "count": 1,
  "count_unit": "flights",
  "contributing_flight_ids": ["F1"],
  "total_record_count": 1,
  "returned_record_count": 1,
  "truncated": false,
  "records": [
    {
      "...": "metric-specific record fields"
    }
  ]
}
```

Notes:

- `count` is always a flight count.
- `count_unit` is always `"flights"`.
- `total_record_count` / `returned_record_count` describe evidence records, not counted flights.
- For pair metrics such as `md5_raw` or `cp25_proxy`, one pair record can explain two counted flights, so `count` can be larger than `total_record_count`.
- The state objects shown below use the same nested point shape wherever they appear:

```json
{
  "time_s": 240.0,
  "lon": 0.1666666666666666,
  "lat": 0.1666666666666666,
  "alt_ft": 11000.0
}
```

- In code, the following nested state fields are nullable and can be `null` if no state can be resolved at that instant:
  - `td.records[*].state_at_sample_end`
  - `hc.records[*].event_state`
  - `sc_groundspeed_proxy.records[*].event_state`
  - `ac_segment.records[*].start_state`
  - `ac_segment.records[*].end_state`
  - `ac_segment.records[*].midpoint_state`

Representative `records[0]` shapes by metric:

`td`

```json
{
  "flight_id": "F1",
  "sector_interval_start_s": 0.0,
  "sector_interval_end_s": 360.0,
  "state_at_sample_end": {
    "time_s": 240.0,
    "lon": 0.1666666666666666,
    "lat": 0.1666666666666666,
    "alt_ft": 11000.0
  }
}
```

`hc`

```json
{
  "flight_id": "F1",
  "event_time_s": 120.0,
  "event_state": {
    "time_s": 120.0,
    "lon": 0.1666666666666666,
    "lat": 0.0,
    "alt_ft": 10000.0
  },
  "heading_before_deg": 90.0,
  "heading_after_deg": 0.0,
  "heading_delta_deg": 90.0
}
```

`sc_groundspeed_proxy`

```json
{
  "flight_id": "F1",
  "event_time_s": 240.0,
  "event_state": {
    "time_s": 240.0,
    "lon": 0.1666666666666666,
    "lat": 0.1666666666666666,
    "alt_ft": 11000.0
  },
  "speed_before_kts": 300.2023036630936,
  "speed_after_kts": 150.10115183154696,
  "speed_delta_kts": 150.10115183154662
}
```

`ac_segment`

```json
{
  "flight_id": "F1",
  "segment_start_s": 120.0,
  "segment_end_s": 240.0,
  "overlap_start_s": 120.0,
  "overlap_end_s": 240.0,
  "start_state": {
    "time_s": 120.0,
    "lon": 0.1666666666666666,
    "lat": 0.0,
    "alt_ft": 10000.0
  },
  "end_state": {
    "time_s": 240.0,
    "lon": 0.1666666666666666,
    "lat": 0.1666666666666666,
    "alt_ft": 11000.0
  },
  "midpoint_state": {
    "time_s": 180.0,
    "lon": 0.1666666666666666,
    "lat": 0.0833333333333333,
    "alt_ft": 10500.0
  },
  "alt_delta_ft": 1000.0
}
```

`md5_raw` / `md10_raw`

```json
{
  "flight_id_a": "F1",
  "flight_id_b": "F2",
  "state_a": {
    "time_s": 240.0,
    "lon": 0.1666666666666666,
    "lat": 0.1666666666666666,
    "alt_ft": 11000.0
  },
  "state_b": {
    "time_s": 240.0,
    "lon": 0.16666666666666663,
    "lat": 0.1666666666666666,
    "alt_ft": 11000.0
  },
  "lateral_nm": 2.9837681334298196e-15,
  "vertical_ft": 0.0,
  "distance_3d_nm": 2.9837681334298196e-15,
  "contributes_flight_ids": ["F1", "F2"]
}
```

`cp25_proxy` / `cp40_proxy` / `cp70_proxy`

```json
{
  "flight_id_a": "F1",
  "flight_id_b": "F2",
  "state_a": {
    "time_s": 240.0,
    "lon": 0.1666666666666666,
    "lat": 0.1666666666666666,
    "alt_ft": 11000.0
  },
  "state_b": {
    "time_s": 240.0,
    "lon": 0.16666666666666663,
    "lat": 0.1666666666666666,
    "alt_ft": 11000.0
  },
  "current_lateral_nm": 2.9837681334298196e-15,
  "current_vertical_ft": 0.0,
  "t_cpa_s": 0.0,
  "cpa_state_a": {
    "time_s": 240.0,
    "lon": 0.1666666666666666,
    "lat": 0.1666666666666666,
    "alt_ft": 11000.0
  },
  "cpa_state_b": {
    "time_s": 240.0,
    "lon": 0.16666666666666663,
    "lat": 0.1666666666666666,
    "alt_ft": 11000.0
  },
  "cpa_midpoint_state": {
    "time_s": 240.0,
    "lon": 0.16666666666666663,
    "lat": 0.1666666666666666,
    "alt_ft": 11000.0
  },
  "cpa_lateral_nm": 1.6653274912495123e-15,
  "cpa_vertical_ft": 0.0,
  "contributes_flight_ids": ["F1", "F2"]
}
```

Additional behavior from the implementation:

- `td`, `md5_raw`, `md10_raw`, `cp25_proxy`, `cp40_proxy`, and `cp70_proxy` are endpoint-active metrics.
- `hc`, `sc_groundspeed_proxy`, and `ac_segment` are full-window metrics, so a flight can appear in those traces even if it is not present in `td` at the sample endpoint.
- Records are sorted before `max_records_per_metric` truncation:
  - `td` by `flight_id`
  - `hc` by descending `heading_delta_deg`, then `event_time_s`, then `flight_id`
  - `sc_groundspeed_proxy` by descending `speed_delta_kts`, then `event_time_s`, then `flight_id`
  - `ac_segment` by descending `alt_delta_ft`, then `overlap_start_s`, then `flight_id`
  - `md5_raw` / `md10_raw` by ascending `distance_3d_nm`, then pair ids
  - `cp25_proxy` / `cp40_proxy` / `cp70_proxy` by ascending `cpa_lateral_nm`, then `cpa_vertical_ft`, then pair ids

The trace response is snapshot-based. If the same pair or event persists across adjacent snapshots, it can appear multiple times across the returned range. That is usually useful for downstream spatial aggregation and heatmap-style visualization.

---

## Error Behavior

- `400 Bad Request`
  - Invalid `time_range`
  - Invalid `metrics`
  - Invalid `sample_seconds`
  - Invalid `max_records_per_metric`

- `404 Not Found`
  - Unknown `collapsed_sector_id`

- `503 Service Unavailable`
  - DD resources cannot be initialized for the active resource state

---

## Example Requests

Suite:

```bash
curl -G "http://localhost:8000/collapsed_sector_dd_suite" \
  --data-urlencode "collapsed_sector_id=EGTTFIS" \
  --data-urlencode "time_range=07:00:00-07:25:00" \
  --data-urlencode "sample_seconds=120"
```

Trace:

```bash
curl -G "http://localhost:8000/collapsed_sector_dd_trace" \
  --data-urlencode "collapsed_sector_id=EGTTFIS" \
  --data-urlencode "time_range=07:00:00-07:25:00" \
  --data-urlencode "sample_seconds=120" \
  --data-urlencode "metrics=hc,cp25_proxy" \
  --data-urlencode "max_records_per_metric=100"
```


# More Context
#### Core DD component definitions, thresholds, units, and data inputs

The following component suite is directly defined in the DD validation work:

| Component (symbol) | Definition (what is counted/measured) | Thresholds & sampling | Units | Data inputs required |
|---|---|---|---|---|
| Traffic Density (TD) | Aircraft count in the sector. citeturn20view0 | Sample interval aligned to DD computation (e.g., 2 min in the validation implementation). citeturn20view0 | aircraft | Radar track-derived trajectories (operational feed). citeturn18view0 |
| Heading Change (HC) | Number of aircraft with heading change > 15° during sample interval. citeturn20view0 | >15°, per 2 minutes. citeturn20view0 | aircraft/events per interval | Trajectory estimates from radar tracks. citeturn18view0 |
| Speed Change (SC) | Number of aircraft with computed airspeed change > 10 kt or > 0.02 Mach during sample interval. citeturn20view0 | >10 kt or >0.02 Mach, per 2 minutes. citeturn20view0 | aircraft/events per interval | Trajectory estimates from radar tracks. citeturn18view0 |
| Altitude Change (AC) | Number of aircraft with altitude change > 750 ft during sample interval. citeturn20view0 | >750 ft, per 2 minutes. citeturn20view0 | aircraft/events per interval | Trajectory estimates from radar tracks. citeturn18view0 |
| Minimum Distance 0–5 NM (MD5) | Number of aircraft whose 3D Euclidean distance to the closest other aircraft is between 0–5 NM at the end of each sample interval; excludes aircraft already categorized under predicted conflicts. citeturn20view0 | 0–5 NM, evaluated at end of each 2-min sample; conflict aircraft excluded. citeturn20view0 | aircraft | 3D positions (x,y,z) derived from radar track data. citeturn20view0turn18view0 |
| Minimum Distance 5–10 NM (MD10) | Same construct as MD5 but for 5–10 NM. citeturn20view0 | 5–10 NM, end of each 2-min sample; conflict aircraft excluded. citeturn20view0 | aircraft | 3D positions derived from radar track data. citeturn18view0turn20view0 |
| Conflict Predicted 0–25 NM (CP25) | Aircraft predicted to be in conflict with another aircraft whose **lateral** distance at end of sample interval was 0–25 NM. citeturn20view0 | 0–25 NM lateral band; computed per sample interval. citeturn20view0 | aircraft | Uses conflict prediction capability (CTAS conflict prediction) plus trajectories. citeturn20view0turn18view0 |
| Conflict Predicted 25–40 NM (CP40) | Same as CP25 for 25–40 NM. citeturn20view0 | 25–40 NM lateral band; per interval. citeturn20view0 | aircraft | Conflict prediction capability (CTAS) plus trajectories. citeturn20view0turn18view0 |
| Conflict Predicted 40–70 NM (CP70) | Same as CP25 for 40–70 NM. citeturn20view0 | 40–70 NM lateral band; per interval. citeturn20view0 | aircraft | Conflict prediction capability (CTAS) plus trajectories. citeturn20view0turn18view0 |
