# Flight Level Distribution Control Notes

## Purpose
This control shows distinct-flight counts by flight level for a traffic volume, with client-side aggregation from the backend's base FL10 bins.

Current reusable implementation:
- `src/components/FlightLevelBinCountChart.tsx`

Primary helper logic:
- `src/lib/flightLevelBinCounts.ts`

## Data contract
The control expects the `flight_level_counts` object from `/api/tv_count_with_capacity`:

```ts
type FlightLevelCountsPayload = {
  bins: Array<{
    start_fl: number;
    end_fl: number;
    count: number;
    label?: string;
    segments?: Array<{
      start_time_str: string; // HH:MM:SS
      end_time_str: string;   // HH:MM:SS
      count: number;
    }>;
  }>;
  metadata?: {
    unit?: string; // currently FL
    max_fl?: number; // currently 500
    num_input_flights?: number;
    num_counted_flights?: number;
    num_intervals_considered?: number;
    time_scope?: {
      from_time_str: string | null;
      to_time_str: string | null;
    };
  };
};
```

Backend assumptions currently baked into the UI:
- Base bins are `FL0-FL500` in `FL10` steps.
- Aggregation modes are `1000 / 2000 / 3000 / 5000 ft`.
- `start_fl` / `end_fl` are in FL units, so `FL10 == 1000 ft`.

## Display behavior
- Header:
  - Left: `FL Distribution`
  - Right: aggregation select
- Chart:
  - Horizontal bar chart
  - Highest FL shown first
  - Zero-count bins are hidden
- Aggregation:
  - Done on the client from the base bins
  - Partial top bucket is allowed if the max FL is not divisible by the chosen mode

## Time-window behavior
The control supports two modes:

1. Full-day / full-response mode
- Use raw `bin.count`

2. Window-filtered mode
- Use `bin.segments`
- Keep only segments overlapping the requested window
- Recompute `bin.count` as the sum of overlapping segment counts
- Then aggregate the filtered bins client-side

Current prop shape:

```ts
<FlightLevelBinCountChart
  data={flightLevelCounts}
  filterToWindow={boolean}
  windowStartSeconds={number}
  windowSeconds={number}
/>
```

## Where it is already integrated
- `src/components/AirspaceInfo.tsx`
  - Filters by the focus window only when focus mode is active
- `src/components/RegulationPanel.tsx`
  - Filters by `regulationTimeWindow`
- `src/components/FlowAirspaceView.tsx`
  - Filters by `regulationTimeWindow`
- `src/components/RerouteTvSelectionInfoPanel.tsx`
  - Uses full-response counts for the primary TV

## Placement rule
The control currently belongs directly under the rolling occupancy chart and above the traffic load bar.

That placement works because:
- it is still TV-context information
- it reads naturally after occupancy/capacity
- it should stay near the rest of the TV-level diagnostics, not inside the flight table

## Reuse guidance
Use this control when:
- the scope is a single traffic volume
- the backend response already includes `flight_level_counts`
- the panel has either an explicit selected window or an all-day TV summary

Do not reuse it blindly when:
- the UI scope is an arbitrary flight list instead of a TV
- the data source is contribution-based rather than TV-wide
- the backend cannot provide `segments` for time-window filtering

## FlightListStatistics recommendation
`FlightListStatistics` is not a natural drop-in target for this control in its current form.

Why:
- `FlightListStatistics` is flight-list scoped
- `tv_count_with_capacity` returns TV-wide FL counts, not counts for the selected flight list
- showing this control there without relabeling would imply "distribution of these selected flights", which would be false

Best integration options:

1. If the intent is TV context only
- Add a compact `Selected TV FL Distribution` section next to the existing `Dwell Time (Selected TV)` section
- Fetch `tv_count_with_capacity` only when `sourceTrafficVolumeId` is present
- Label it explicitly as TV-wide context, not as flight-list statistics

2. If the intent is flight-list-specific FL distribution
- Do not reuse `tv_count_with_capacity` directly
- Extend `original_flight_contrib_counts` or add a dedicated endpoint that returns FL-bin counts for the selected `flightIds` within the selected TV
- Then either reuse this component with a different title or create a thin wrapper around it

Recommendation:
- For correctness, option 2 is the better long-term design
- For fast delivery, option 1 is acceptable only if the UI copy makes the TV-wide scope explicit
