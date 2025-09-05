### Goal
Design a full UI/UX and integration plan for the Flow Impact Evaluation page that:
- Accepts inputs (flows, target/ripple TVs + time windows, optional weights)
- Calls the backend POST `/base_evaluation`
- Visualizes per-flow TV histograms
- Shares a single TimeScaleControl that controls the x-range for all histograms
- Highlights the controlled volume
- Summarizes objective and weights
- Adds “Preview Baseline” in `FlowPlanPanel.tsx` to open the page with proper URL params
- Use the reference visual appearance from `/original_count/page.tsx`

### Page, routing, and URL contract
- **Route**: `src/app/flow-evaluation/page.tsx` (standalone analytics page mirroring the `original_count` look-and-feel).
- **URL params**
  - `payload`: URL-safe base64-encoded JSON of the request body (flows/targets/ripples/weights).
  - `view`: optional initial view window `"HH:MM-HH:MM"` for histograms.
  - `autostart`: optional boolean `"1"` to automatically POST on mount (default on when `payload` present).
- **Shareability**
  - Provide “Copy link” that re-encodes the current input and view window back into `payload`/`view`.

### API integration
- **Next proxy**: `src/app/api/base_evaluation/route.ts`:
  - POST body forwarded to `${BACKEND_URL || 'http://localhost:8000'}/base_evaluation`.
  - Mirrors the error handling style used in `regulation_plan_simulation`.
- **Types** (add to `src/lib/models.ts`)
  - `BaseEvaluationResponse`: fields from the spec: `num_time_bins`, `tvs`, `target_cells`, `ripple_cells`, `flows` (array of `FlowEval`), `objective`, `weights_used`.
  - `FlowEval`: `flow_id`, `controlled_volume`, `n0`, `demand`, `target_demands`, `ripple_demands`.
- **Minutes per bin**
  - Compute `minutesPerBin = Math.round(1440 / num_time_bins)`; tolerate non-divisible days by rounding and clearly document.
  - Use `minutesPerBin` as `stepMinutes` in `TimeScaleControl` (integer).

### State management (page-local)
- **Decoded input**: `{flows, targets, ripples?, weights?}`
- **Fetch state**: `{loading, error, data}`
- **View range**: `{viewFromHHMM, viewToHHMM}`; default from `view` query or `"00:00"–"23:59"`.
- **Advanced (collapsed)**: indexer_path, flights_path, capacities_path (optional inputs in the request body).
- **UI toggles**:
  - Show/hide raw request and response.
  - Show labels vs indices on histograms.

### Input Summary section (top of page)
- **Flows**:
  - List each flow with:
    - Flow label and color (if provided via payload; otherwise auto-assign).
    - Flight count.
  - Expand to show first N flight IDs; a “Show all” accordion for long lists.
- **Target TVs**
  - For each TV: show its merged time window(s) as chips.
  - If multiple windows exist for the same TV in source inputs, unify to `[min(from), max(to)]` for the POST body as per spec; also show original windows in a tooltip for transparency.
- **Ripple TVs** (optional)
  - Same representation and merging as targets.
- **Weights**
  - Small editable grid for partial overrides (alpha_gt, lambda_delay, etc.) with a “Re-run” button.
  - Show “Effective weights” from `weights_used` after results load.

### TimeScaleControl (global)
- Place as a dedicated card titled “Histogram View Range”.
- `stepMinutes = minutesPerBin` from the last successful response (or 15 default).
- `onCommit` updates local `viewFromHHMM`/`viewToHHMM` and re-filters charts without re-querying.

### Per-flow Results section
For each `flow` in `data.flows`:
- **Header**
  - “Flow {id} • {numFlights} flights”
  - “Controlled volume: {controlled_volume}” badge.
- **Layout**
  - Two subgrids:
    - Targets: All `target_demands` TVs.
    - Ripples: All `ripple_demands` TVs (if any).
  - Chart order: put `controlled_volume` card first in the target grid.
- **Histogram card spec**
  - Bars: counts by bin (array length `T`).
  - X domain filter: bins whose start minute is within `[viewFrom, viewTo]`.
  - Controlled volume styling: pink/red accent border and top-left “Controlled” badge.
  - Highlight attention bins:
    - Use `target_cells` and `ripple_cells`: for the current TV, accent bars for bins present in those arrays.
  - Below chart: tiny metric row
    - Total across day
    - Peak bin value+index (tooltip shows `HH:MM-HH:MM`)
    - Sum across attention bins (target or ripple, based on section)
- **Tooltips**
  - Label with `binIndexToRangeLabel(i, minutesPerBin)`.
  - Value display: “Count: N”.

### Objective & dashboard section (bottom)
- **Objective card**
  - Big `objective.score`.
- **Components grid**
  - Cards for `J_cap`, `J_delay`, `J_reg`, `J_tv`, etc.
- **Weights used**
  - Collapsible details showing `weights_used`.
- **Actions**
  - Re-run with current weights.
  - Download JSON (response) and CSV (two variants):
    - Per-TV time series per flow (rows=bins, columns=TVs).
    - Objective components single-row table.

### Error, empty, and loading states
- **Loading skeletons**: gray shimmering cards for charts and stats.
- **Graceful empties**:
  - No ripples: hide ripple section.
  - No demands for a TV: show empty-state card with “No data”.
- **Warnings**
  - If any input items were dropped (infer by diffing inputs vs response TVs/flows), show a small warning banner.

### Performance considerations
- Virtualize large grids (e.g., `react-virtualized` or simple “Show more” pagination).
- Cap default charts per flow (e.g., 12) with an expand control.
- Avoid re-render storms by memoizing computed rows and highlight maps per TV.

### Hook from `FlowPlanPanel.tsx` (“Preview Baseline”)
- **Button placement**: at the panel footer, after the Flow Basket list.
- **On click**
  - Build request body:
    - flows: map numeric flow ids to flight IDs
      - Stable mapping: sort `flowBasket` by `createdAt`; index starting at 0.
      - For each flow, collect `items[].key`:
        - If `key` is callsign and resolves to a flightId, prefer the flightId; else use the `key` as-is per spec (unknowns are ignored).
    - targets: reduce `targetCells` to TV → {from, to} by merging windows per TV to the min-span window.
    - ripples: none by default (or add later when ripple selection UI exists).
    - weights: omit unless an override UI exists in this panel (keep simple).
  - Encode payload to URL-safe base64.
  - Navigate to `/flow-evaluation?payload=...&autostart=1`.
- Optional: Pass a `colorsByFlow` map so the page can keep consistent flow colors for summary chips.

### Visual design notes
- Match `original_count` card aesthetics: `bg-white/5`, `border-white/10`, rounded corners.
- Controlled volume border: `border-rose-400/70` with subtle glow on hover.
- Attention bins: bar overlay with a thin top line or semi-transparent fill to avoid overpowering the chart.
- Use a consistent small font for metric rows, mono font for time labels.

### Testing & acceptance
- Unit
  - Minutes-per-bin derivation, bin-to-minute mapping, and view range filtering.
  - Merge of multiple windows per TV.
  - Payload encoding/decoding round-trip.
- Integration
  - Proxy route returns backend data and error surfaces correctly.
  - Full flow: create two basket flows with flights + add two target cells → Preview Baseline → page autoloads and renders.
- UX
  - TimeScaleControl updates all charts without re-fetch.
  - Controlled volume always first and highlighted.
  - Objective and components render and match example shapes.

### Future enhancements (optional)
- Ripple selection UI in `FlowPlanPanel` or on eval page (promote a target to ripple).
- Overlay capacity lines if/when capacities per TV are included.
- Pin specific TVs across flows for side-by-side comparison.
- Persist last used weights and view window in localStorage.

- Added a detailed plan for a new page `src/app/flow-evaluation/page.tsx`, a proxy API `src/app/api/base_evaluation/route.ts`, new types in `src/lib/models.ts`, a per-flow chart grid with controlled-volume highlighting, a global `TimeScaleControl`, and an objective dashboard.
- Outlined how the “Preview Baseline” button in `FlowPlanPanel.tsx` builds the POST body from `flowBasket` and `targetCells`, encodes it, and navigates with URL params.s