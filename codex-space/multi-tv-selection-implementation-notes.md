# Multi-TV Selection Feature Notes (Monitoring Page)

## Why this exists
These notes capture implementation-specific observations from adding multi-traffic-volume (TV) selection to the monitoring page (`MapCanvas` + `AirspaceInfo` + `RightControl1`).

If this feature is copied or expanded to another page/canvas/panel, these are the things most likely to cause subtle regressions.

## High-level architecture decisions
- Multi-select state was added to the shared Zustand store (`selectedTrafficVolumes`) while preserving the legacy single-TV fields (`selectedTrafficVolume`, `selectedTrafficVolumeData`).
- `selectedTrafficVolume` is treated as the primary TV and mirrors `selectedTrafficVolumes[0]`.
- Map highlight is now driven by the selected TV list (store-driven), not local single-highlight state.
- `AirspaceInfo` performs client-side fan-out across the existing single-TV APIs and aggregates on the client.
- Summary cards / overload bar / hourglass remain primary-TV scoped by design.

## Store invariants (important)
When reusing this feature, preserve these invariants:
- `selectedTrafficVolume === selectedTrafficVolumes[0] ?? null`
- `selectedTrafficVolumeData` should correspond to the primary TV (best-effort via local cache)
- TV selection and collapsed-sector selection are mutually exclusive

Why this matters:
- A lot of existing code across the app still reads only `selectedTrafficVolume`.
- Breaking the mirror invariant will cause UI inconsistencies and hard-to-debug map/panel state issues.

## Selection behavior that was intentionally chosen
- Plain click in monitoring TV mode toggles membership.
- First selected TV stays primary until removed.
- Max selected TVs is capped at 5.
- Search/hotspot selection still uses the old `setSelectedTrafficVolume(...)` path and therefore resets to a single TV.
- Closing the right panel clears all selected TVs and resets focus mode.

If you copy this to another page:
- Confirm whether that page expects additive selection or replacement behavior from search/hotspot interactions.

## API behavior caveat (most important functional caveat)
Current implementation for secondary TVs uses:
- `/api/tv_count_with_capacity?traffic_volume_id=...`
- `/api/tv_flights?traffic_volume_id=...&ref_time_str=...`

Important caveat:
- We assume `tv_flights_ordered` (used when `ref_time_str` is present) returns a sufficiently complete set for membership/intersection and best-effort traversal-order filtering.
- If the backend ordered endpoint is truncated around the reference time, multi-TV intersection correctness can be wrong (missing flights that reach another TV later), and order-sensitive filtering can also drop otherwise valid flights.

What to do for robust correctness:
- Add a backend endpoint for full membership/all flights per TV (or no-truncation ordered results).
- Use that endpoint for intersection membership.
- Keep ordered endpoint for arrival/dwell/sorting metadata if needed, or move ordered traversal semantics fully backend-side.

## `AirspaceInfo` aggregation notes
### Chart aggregation
- Each TV gets its own rolling-hour occupancy series and capacity line.
- A shared x-axis is built from the union of time bins across selected TVs.
- Missing bins for a given TV are represented as `null` in merged chart rows.
- Focus mode filters chart rows by window after merge (shared axis rows).

Why this matters elsewhere:
- If another page uses different bin sizes or labels, the union-by-time-label merge may need normalization first.

### Flight list aggregation
- Flight list starts from the intersection across all selected TVs (not union).
- A second client-side pass then applies best-effort traversal-order filtering based on the selected TV order (`selectedTrafficVolumes`).
- A flight is removed if its known per-TV comparable times run backward relative to the selected order.
- Comparable time uses `arrivalSeconds` first and falls back to `windowStartSeconds`.
- Sorting is deterministic and multi-TV aware:
  - `min(abs(delta_seconds))` across TVs
  - tie-break by primary TV `abs(delta_seconds)`
  - tie-break by primary TV arrival time
  - final tie-break by `flightId`
- Focus mode filtering is applied after intersection/order filtering and keeps rows if any selected TV arrival/window-start falls within the focus window.

Why this matters elsewhere:
- If a page expects union semantics (e.g., flow exploration), the current helper logic is the wrong default.
- If a page needs guaranteed ordered traversal semantics instead of best-effort client filtering, the current helper logic is also the wrong default.

## Legacy vs ordered flight payload compatibility
The code supports both payload shapes from `/api/tv_flights`:
- Ordered (`ordered_flights` + `details`)
- Legacy (timeWindow -> flightIds map)

Behavior when legacy data is returned:
- Membership still works
- Arrival/Dwell columns show `N/A`
- Sorting degrades to available metrics (`windowStartSeconds` fallback)
- Traversal-order filtering also degrades to `windowStartSeconds` fallback when available

If you expand this feature:
- Keep this compatibility unless you can guarantee ordered payloads everywhere.

## Map highlight / selection interaction notes
- `MapCanvas` still has local hover highlight, but selected highlight is store-driven and multi-select aware.
- The old `clearTrafficVolumeHighlight` event is still listened to, but panel close correctness now comes from clearing store selection.
- Search-selection fly-to behavior is kept event-driven and independent of highlight state.

Why this matters elsewhere:
- If you duplicate map code and leave local selected-highlight state in place, it will conflict with store-driven multi-highlight.

## Performance / UX notes observed during implementation
- Occupancy data requests do not need to refetch every `t` change; the current implementation skips redundant occupancy refetches when selection is unchanged and data is already cached.
- Flight data requests intentionally refetch on `ref_time_str` changes because sorting/arrival proximity is time-dependent.
- Order-sensitive filtering uses the same per-TV timing metadata, so it inherits the same refetch and completeness assumptions.
- Dynamic per-TV flight columns can get wide quickly; horizontal scroll is required.
- Max-5 selection limit is mostly for readability and request fan-out control.

## Copying to other pages/components
Before copying this feature into another page (e.g., regulation/flow/predictions variants), check:
- Does the page use a different map canvas component with separate highlight logic?
- Does the panel rely on single-TV-only assumptions in downstream actions (stats dialogs, proposals, regulations)?
- Should search/hotspot interactions append or replace selection on that page?
- Are the APIs on that page time-sensitive (ordered/truncated) in a way that breaks intersection or traversal-order correctness?
- Does that page need primary-only summary widgets, or true multi-TV summaries?

## Files that were central to this implementation
- `src/components/useSimStore.ts`
- `src/components/MapCanvas.tsx`
- `src/components/RightControl1.tsx`
- `src/components/AirspaceInfo.tsx`
- `src/lib/trafficVolumeLayers.ts`
- `src/lib/multiTrafficVolumeSelection.ts`
- `src/lib/airspaceInfoMultiTv.ts`

## Recommended next improvements (if revisiting)
- Add a dedicated backend endpoint for full-flight membership per TV to guarantee correct multi-TV intersections.
- If ordered traversal becomes a hard requirement, add a backend endpoint that accepts an ordered TV list and returns backend-computed ordered-path matches.
- Add component tests for `AirspaceInfo` multi-TV rendering (dynamic columns + header + close/reset semantics).
- Consider extracting a reusable multi-TV panel/data hook if this is copied to regulation/flow pages.
