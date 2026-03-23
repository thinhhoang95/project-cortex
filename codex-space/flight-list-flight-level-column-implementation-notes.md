# Flight List FL Column Implementation Notes

## Scope

This note documents the frontend changes made to surface crossing-scoped flight level ranges in flight-list tables.

Updated components:

- `src/components/AirspaceInfo.tsx`
- `src/components/RegulationFlightListLeftPanel2.tsx`
- `src/components/FlowAirspaceView.tsx`
- `src/components/RerouteBaseFlightListPanel.tsx`

## API Nuances

### `/tv_flights_ordered`

The ordered TV flight payload now includes `details[].flight_level_range`:

```json
{
  "min_fl": 330,
  "max_fl": 350,
  "label": "FL330-FL350",
  "scope": "tv_overlap"
}
```

Important details:

- The range is scoped only to the selected TV crossing overlap, not the whole trajectory.
- If no crossing-scoped range can be resolved, the backend returns the sentinel label `FL -1`.
- Existing `dwell_seconds` behavior is unchanged.

### `/regulation_ranking_tv_flights_ordered`

The ranked regulation payload now includes `ranked_flights[].flight_level_range` with the same semantics as `/tv_flights_ordered`.

Important details:

- `flight_level_range` is inherited from the selected crossing used for ranking.
- `duration_min` filters by entry time window after ranking, but returned rows still carry the same crossing-scoped FL metadata.
- Sentinel behavior is the same: unresolved range returns `FL -1`.

## Frontend Data Modeling

Each updated panel extended its ordered-flight detail type to accept:

```ts
flight_level_range?: {
  min_fl?: number | null;
  max_fl?: number | null;
  label?: string | null;
  scope?: string | null;
} | null;
```

Each panel also extended its per-TV cell model to carry a display-ready field:

```ts
flightLevelRangeLabel: string | null;
```

This keeps table rendering simple and avoids recomputing display formatting in JSX.

## Display Rule

The requested UI behavior was to avoid repeating `FL` in the table column.

Implemented compact formatting:

- `FL330-FL350` -> `330-350`
- `FL 330-FL 350` style variants are handled by the regex as long as they match the existing backend label pattern
- `FL -1` -> `-1`
- If `label` is absent but `min_fl` and `max_fl` are valid, display falls back to `min-max`
- If neither label nor valid numeric bounds exist, display `N/A`

All four panels currently use local helper functions with the same logic rather than a shared utility.

## Table Structure Change

Per selected TV, flight-list tables changed from:

- `Arr.`
- `Dwell`

to:

- `Arr.`
- `FL`
- `Dwell`

This required updating each panel's dynamic column count and `colSpan` calculation for:

- see-more / see-less rows
- expandable summary rows
- any layout that depends on per-TV column count

## Panel-Specific Notes

### `AirspaceInfo.tsx`

- Updated the ordered `details` type for `/api/tv_flights`.
- Added `flightLevelRangeLabel` to `TvFlightCell`.
- Populated FL values from ordered TV detail rows.
- Legacy payload fallback still shows `N/A` for FL because old grouped payloads do not contain crossing-specific FL metadata.
- Multi-TV tables now render `Arr. / FL / Dwell` per TV.

### `RegulationFlightListLeftPanel2.tsx`

- Updated both:
  - `RankedFlight` from `/api/regulation_ranking_tv_flights_ordered`
  - `OrderedTvFlightsData` for secondary TV intersection lookups via `/api/tv_flights`
- Primary ranked rows now carry FL from `ranked_flights[].flight_level_range`.
- Secondary intersected TV columns use FL from ordered TV detail rows.
- Legacy secondary TV data still falls back to `N/A`.
- The FL column was given explicit width protection to avoid wrapping:
  - header uses `min-w-[72px]`
  - cell uses `whitespace-nowrap min-w-[72px]`

### `FlowAirspaceView.tsx`

- No API change was needed because it already uses `/api/tv_flights`.
- Primary ordered rows now read `details[].flight_level_range`.
- Secondary TV intersection rows do the same.
- Legacy payload fallback remains `N/A`.
- `colSpan` was updated from `selectedTvIds.length * 2` to `selectedTvIds.length * 3`.

### `RerouteBaseFlightListPanel.tsx`

- No backend change was needed because it also uses `/api/tv_flights`.
- Ordered TV detail rows now carry compact FL values into the per-TV cell map.
- Legacy payload fallback remains `N/A`.
- `colSpan` was updated to account for the added FL column.

## Why FL Formatting Is Local Today

The formatting logic is duplicated intentionally for now because:

- the change was small and isolated to a few components
- each panel already had local helper conventions
- the immediate goal was to ship the UI update without a broader formatting refactor

If this FL display spreads further, the obvious cleanup is a shared formatter in `src/lib`.

## Behavior Guarantees

Current behavior across all updated tables:

- Ordered payload + resolved crossing range -> compact numeric FL range
- Ordered payload + unresolved crossing range -> `-1`
- Legacy payload -> `N/A`
- No table should show repeated `FL330-FL350` text anymore in the new FL column

## Verification

Validation run after the changes:

```bash
npx tsc --noEmit
```

This passed after the panel changes and the Regulation panel layout tweak.
