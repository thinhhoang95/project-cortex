### Goal
Add a fourth histogram mode in the Flow Evaluation page: “Occupancy/Original”, which shows, per TV and per time bin, a stacked-bar of per-flow occupancy contributions over the total original occupancy (with an optional “Other” segment for the remainder to total).

### Key alignment decisions
- **Time binning**: Use the same bin size across sources. In `flow-evaluation/page.tsx`, bins come from `evalState.data.num_time_bins` → minutes via `1440 / T`. Fetch `/original_counts` without a time window to get full-day arrays and filter by current view range in the chart (consistent with other charts).
- **Rolling-hour**: Flow per-bin occupancy (`target_occupancy`, `ripple_occupancy`) is raw per-bin. Request `/original_counts` with `rolling_hour: false` to match.
- **TV set**: Use the union of all TVs that appear in any flow’s `target_occupancy` and `ripple_occupancy`. Request those explicitly via `traffic_volume_ids` to ensure we always get them in `mentioned_counts`.

### UI changes (Flow Evaluation)
- **Toggle**: Extend the existing “Histogram Values” toggle in `src/app/flow-evaluation/page.tsx` to include a fourth button:
  - `seriesView` type → `'demand' | 'occupancy' | 'occupancy_all' | 'occupancy_original'`
  - Add button labeled “Occupancy/Original”.
- **Section**: When `seriesView === 'occupancy_original'`, show a new section (similar to the Occupancy All section) rendering per-TV stacked charts. Hide the per-flow sections in this mode (as is done for Occupancy All).

### Data fetching/state
- Add state for original counts:
  - `origCountsState = { loading: boolean; error: string | null; data: CountsResponse | null }`
- Build the TV union:
  - `const tvUnion = useMemo(() => new Set<string>(... from flow.target_occupancy keys and flow.ripple_occupancy keys across all flows))`
- On selecting “Occupancy/Original” (or when inputs change and this tab is active):
  - POST `/api/original_counts` with:
    - `traffic_volume_ids`: `Array.from(tvUnion)`
    - `rolling_hour: false`
    - No `from_time_str` / `to_time_str` (full day)
    - `rank_by: "total_count"` (not critical, we’ll read from `mentioned_counts` primarily)
  - Store response in `origCountsState`.
- Minutes/bins:
  - Prefer `evalState.data.num_time_bins` → `minutesPerBin`. Verify `data.time_bin_minutes` if present; warn/guard when mismatched (rare).

### Transformation and stacking logic
- For each `tvId` in `tvUnion`:
  - Pick the total series:
    - Prefer `data.mentioned_counts[tvId]` else `data.counts[tvId]`.
    - Capacity line: prefer `data.mentioned_capacity[tvId]` else `data.capacity[tvId]`.
  - Build per-flow contributions:
    - For each flow, if `tvId` is a key in `flow.target_occupancy` use that series; if not, check `flow.ripple_occupancy`.
    - Keep a dictionary `flowId -> number[]` with aligned length T; missing → zeros.
  - Per bin i:
    - `total = originalCounts[i] || 0`
    - `sumFlows = sum(flowSeries[i] for all flows)`
    - `other = max(total - sumFlows, 0)` (clamp at 0; if `sumFlows > total`, keep `other = 0` and we can optionally show a small badge “>100%” on the chart to flag overlap).
- Filtering to the view window:
  - As with other histograms, filter by `viewFrom`/`viewTo` using bin start minutes `i * minutesPerBin`.

### Rendering (Recharts)
- One card per TV in a grid, similar to existing cards:
  - `ComposedChart` with stacked `Bar` for each flow id (stable color via `input.colorsByFlow` if provided; fallback palette), plus a final stacked `Bar` for “Other”.
  - Optional `Line` for capacity (stepAfter), if capacity provided (and non-negative).
  - Tooltip: show each flow’s bin contribution, “Other”, and “Total” (sum of displayed parts).
  - X-axis labels use `binIndexToRangeLabel(i, minutesPerBin)`, same as current.
- Legend:
  - Compact legend showing Flow N color mapping; optionally collapsible when many flows.

### UX, limits, and ordering
- **TV ordering**: Put any `controlled_volume` TVs first, then sort by descending total occupancy over the current view window.
- **Flow ordering in stacks**: Sort flows by descending total contribution for that TV (stable per TV) to reduce color flicker.
- **Limits**: If many TVs, show up to N (e.g., 12) with “Show more”.
- **Performance**: For N TVs * F flows * T bins (T≈96), the O(N·F·T) summation is fine. Memoize per-TV results keyed by `origCountsState.data` + `evalState.data.flows` + `viewFrom/viewTo`.

### Error and edge handling
- If `/original_counts` fails, show a terse error banner in this section only.
- If `tvUnion` is empty (e.g., no results yet), show an info message.
- If minutes-per-bin mismatch, show a subtle warning and skip or adapt (optional). In practice they should match.
- If capacity series is missing or `-1`, don’t render the capacity line.

### Minimal data wiring references
- Per-flow occupancy comes from:
  - `evalState.data.flows[].target_occupancy` and `ripple_occupancy`
- Original totals come from:
  - `/api/original_counts` → use `mentioned_counts` for the explicitly requested TVs; `capacity` or `mentioned_capacity` for the line; `time_bin_minutes` for bin size (sanity check).

### Implementation checklist
1. Extend `seriesView` union and toggle UI in `src/app/flow-evaluation/page.tsx`.
2. Add `origCountsState` and `handleSelectOccupancyOriginal()`:
   - Build `tvUnion`, POST to `/api/original_counts` with `rolling_hour: false` and `traffic_volume_ids`.
   - Save response; handle errors.
3. Data shaping:
   - Compute per-TV flow contributions + “Other” array; memoize.
4. New section render when `seriesView === 'occupancy_original'`:
   - Grid of per-TV `ComposedChart` cards (stacked bars for flows + “Other”, optional capacity line).
   - Respect the view range and labels; add “Show more”.
5. Colors/legend:
   - Use `input.colorsByFlow` if present; otherwise assign stable palette.
6. Edge handling:
   - Clamp negative “Other” to 0; optionally badge when `sumFlows > total`.
7. QA:
   - Verify bin alignment, tooltips, totals, and that view range filtering matches other charts.
   - Confirm behavior when some flows don’t contribute to a TV (zeros).
   - Confirm no dependency on optimization (works right after “Run Evaluation”).

