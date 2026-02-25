# Multi-TV Selection Feature Notes (Regulations Page)

## Why this exists
These notes capture implementation-specific observations from extending multi-traffic-volume (TV) selection to the regulations page (`RegulationCanvas` + `RegulationPanel` + `RegulationFlightListLeftPanel2`).

This page behaves differently from the monitoring page because:
- it has a regulation-specific ranked flight list endpoint,
- it has Flow Extraction tied to the left flight list,
- it has slack overlay behavior in the canvas,
- and regulation summary widgets are intentionally primary-TV scoped.

## High-level behavior choices (intentional)
- Multi-select is enabled on map TV clicks in `RegulationCanvas` using `toggleSelectedTrafficVolume(...)`.
- Search/hotspot TV selection still uses the single-select path (`setSelectedTrafficVolume(...)`) and resets selection to one TV (same as monitoring semantics).
- Primary TV is `selectedTrafficVolumes[0]` and remains the “reference TV” until removed.
- Panel close clears all selected TVs via `clearSelectedTrafficVolumes()`.

## Store invariants reused (do not break)
These still matter on the regulations page:
- `selectedTrafficVolume === selectedTrafficVolumes[0] ?? null`
- `selectedTrafficVolumeData` corresponds to the primary TV (best-effort cache)
- TV selection and collapsed-sector selection remain mutually exclusive

Why this matters here:
- `RegulationPanel`, `RegulationCanvas`, and some flow/regulation actions still use `selectedTrafficVolume` as the primary scope.

## Regulations page / panel visibility coupling
- `src/app/regulations/page.tsx` was updated so the regulation panel opens when either:
  - `selectedTrafficVolumes.length > 0`, or
  - legacy `selectedTrafficVolume` is populated

If you copy this pattern elsewhere:
- Include the legacy fallback if persisted state can contain only the single-TV field.

## Map selection + highlight changes (RegulationCanvas)
- TV click selection is now store-driven multi-select (`toggleSelectedTrafficVolume`).
- TV highlight is store-driven via `applyTrafficVolumeHighlightList(...)` (not local selected-highlight state).
- Hover highlight is still local and single-TV (`hoveredTrafficVolume`), which is fine.

### Important slack overlay change
Before multi-select, local selected-highlight state was also used to trigger slack fetches.

After multi-select:
- selected highlight comes from store selection list
- slack fetch/display remains effectively primary-TV scoped (uses `selectedTrafficVolume`)
- `clearTrafficVolumeHighlight` now clears slack overlay/local slack state, not selected TV highlight

Why this matters:
- If you reintroduce local “selected highlight” state later, it will fight the store-driven highlight list.

## Flow-mode label visibility (RegulationCanvas)
When flow view is active, the canvas intentionally de-clutters sector visuals and only keeps labels for:
- selected TVs
- active hotspots

With multi-select, that whitelist must include **all selected TVs**, not just `selectedTrafficVolume`.

This is easy to miss because the bug only shows up in flow view.

## RegulationPanel scoping decisions (very important)
`RegulationPanel` is now mixed-scope by design:

Primary-TV scoped:
- current count / capacity summary cards
- rate defaulting
- traffic overload bar
- add regulation target TV (`trafficVolume` on regulation payload)
- edit payload matching (`payload.trafficVolume === primaryTvId`)

Multi-TV scoped:
- selected header (shows all selected TVs, primary labeled reference)
- focus flight filtering (uses intersecting list when multiple TVs selected)
- flow extraction candidate list (intersection)
- occupancy chart (multi-series when multiple TVs selected)

Why this matters:
- If you assume “multi-select means every widget is aggregated,” you’ll accidentally change regulation semantics.

## Occupancy chart implementation details (RegulationPanel)
- Primary occupancy fetch path was kept intact for summary/rate widgets.
- Secondary TVs fetch occupancy via additional `/api/tv_count_with_capacity` requests.
- Multi-series chart data is built by:
  - reusing primary rolling chart data already computed in `RegulationPanel`
  - building rolling chart data for secondaries via `buildRollingChartDataFromOccupancy(...)`
  - merging onto a shared x-axis via `buildMergedMultiTvChartRows(...)`
- Multi-series chart renders:
  - one bar series per TV (occupancy)
  - one line series per TV (capacity)
  - current-time reference line on merged axis

### Important chart caveats
- Summary cards/load bar/rate remain primary-only even when chart is multi-series.
- Secondary occupancy fetch failure currently degrades silently (no explicit error UI for the chart).
- If TVs return different time bins/labels, merge relies on time-label compatibility (same caveat as monitoring page).

## Left flight list is now the canonical multi-TV intersection source
This is the most important regulations-specific coupling.

`RegulationFlightListLeftPanel2` now:
- uses the regulation ranking endpoint for the **primary TV** (`/api/regulation_ranking_tv_flights_ordered`)
- fetches `/api/tv_flights` for secondary TVs
- intersects primary ranked/window-filtered flights with secondary memberships
- publishes intersecting IDs to:
  - `regulationVisibleFlightIds`
  - `regulationListedFlightIds`

Then `RegulationPanel` uses those store IDs for:
- multi-TV focus filtering
- `Extract Flows`
- magic search dialog flight universe

Why this matters:
- If the left panel is hidden, removed, or refactored independently, flow extraction/focus behavior can break unless you preserve this publishing behavior.

## Intersection semantics in regulations are not identical to AirspaceInfo
The regulations flight list mirrors the *style* of AirspaceInfo (intersection + multi-TV columns), but the source pipeline differs:

- Primary ordering comes from a regulation ranking endpoint (top-K ranked list)
- Secondary TVs use `tv_flights` membership/details
- Intersection is applied **after** primary ranking/window filtering

This means the resulting list is:
- “intersection of currently ranked primary flights and secondary memberships”
- not necessarily “all flights intersecting every selected TV”

### Consequence (easy to miss)
Because the primary ranking endpoint is capped (`top_k=500`), valid intersecting flights beyond the primary top-K are excluded from:
- left flight list
- `regulationListedFlightIds`
- `Extract Flows`

If you need full intersection completeness:
- add a dedicated backend endpoint for multi-TV regulation candidates or full primary candidate membership
- do not rely on primary top-K ranking output as the full universe

## Extract Flows behavior change
`Extract Flows` now uses the intersecting list (`regulationListedFlightIds`) and therefore is conditioned on multi-TV intersection.

Current call pattern remains:
- `traffic_volume_id = primaryTvId`
- `flight_ids = intersected IDs`

Why this works:
- intersection guarantees those IDs are in the primary TV too

Potential future issue:
- if backend semantics later change to infer candidates from `traffic_volume_id` independently of `flight_ids`, this assumption should be re-verified.

## Ordered vs legacy `tv_flights` payload compatibility still matters
Secondary TV intersection logic supports both:
- ordered payloads (`ordered_flights` + `details`)
- legacy payloads (time-window map)

Behavior with legacy payloads:
- membership/intersection still works
- per-TV arrival/dwell columns show `N/A`
- sorting falls back to available metrics (`windowStartSeconds`/primary ties)

If you copy this elsewhere:
- keep this compatibility unless backend payload shape is guaranteed.

## Focus-mode behavior changed subtly
When multiple TVs are selected, `RegulationPanel` focus filtering now uses `regulationListedFlightIds` (published by the left list intersection), not the panel’s local single-TV flight payload.

Why this matters:
- Focus mode is now indirectly dependent on left-panel data readiness and correctness.
- This is intentional for consistency with the flow-extraction universe.

## UX/performance observations
- Occupancy chart fan-out adds one request per extra TV (`tv_count_with_capacity`).
- Left flight list fan-out adds one `tv_flights` request per extra TV on `t` changes.
- Multi-TV columns (left list and chart legend) get wide quickly; horizontal overflow is required.
- We intentionally kept prior rows during refetch in the left list to avoid flicker while time advances.

## Copying this feature elsewhere: checklist
Before copying to another page/panel:
- Does that page use ranking/top-K endpoints (truncation risk)?
- Is the intersection source intended to be a ranked subset or the full membership universe?
- Are downstream actions (flow extraction / proposals / simulation) tied to the left list store IDs?
- Which widgets should stay primary-TV scoped vs be truly aggregated?
- Is map overlay logic (e.g., slack, risk, weather, labels) accidentally coupled to single selected highlight state?
- Should search selection append or replace selection?

## Files that were central in this regulations implementation
- `src/app/regulations/page.tsx`
- `src/components/RegulationCanvas.tsx`
- `src/components/RegulationPanel.tsx`
- `src/components/RegulationFlightListLeftPanel2.tsx`
- `src/components/useSimStore.ts`
- `src/lib/trafficVolumeLayers.ts`
- `src/lib/airspaceInfoMultiTv.ts`

## Recommended next improvements (if revisiting)
- Add explicit UI error state for secondary occupancy chart fetch failures.
- Add a backend endpoint for complete multi-TV regulation candidate membership (avoid primary top-K truncation bias).
- Add component tests for:
  - multi-TV left list intersection publishing (`regulationListedFlightIds`)
  - `Extract Flows` empty/intersection states
  - panel close clearing all selected TVs + flow/focus reset
- Consider extracting a shared “multi-TV flight intersection + per-TV details” hook used by `AirspaceInfo` and regulation panels.
