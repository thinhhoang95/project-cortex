### Goal
Let users save an “optimized solution” snapshot from the Flow Evaluation page and compare multiple solutions side-by-side on a new Comparison page, respecting a shared time window.

### What gets captured in a snapshot
- **Identity & context**
  - `id` (uuid/timestamp), `createdAt`, `description` (user-entered), `sourceRoute` (e.g., `flow-evaluation`), `shareUrl` (optional, from `encodedShareUrl`).
- **Inputs & config**
  - `payload` (flows, targets, ripples), `weights_used` (or override), `sa_params_used`, `minutes_per_bin`, `timebins.labels` (if present).
- **Optimization outcomes**
  - `objective_baseline`, `objective_optimized`, `components` per objective (both baselines and optimized).
  - `delays_min` map (flightId → minutes).
  - `flows` with post-optimization series: `target_occupancy_opt`, `ripple_occupancy_opt`, and post rates if available.
- **Aggregated occupancy (optional but recommended for charts)**
  - From `/api/autorate_occupancy`: `pre_counts`, `post_counts`, `capacity`, `time_bin_minutes`, `tv_ids_order`, `timebins.labels`.

Note: This is enough to render flight delays, objective comparisons, and occupancy charts without re-calling APIs.

### Where to capture in the existing page (`src/app/flow-evaluation/page.tsx`)
- Add an “Add to Comparison” button visible only when `optState.data` exists.
- On click:
  - Prompt for a description (small inline input or modal).
  - Ensure aggregated occupancy is fetched (reuse `handleSelectOccupancyAll`’s call to `/api/autorate_occupancy`).
  - Build a `SolutionSnapshot` object from `input`, `evalState.data`, `optState.data`, and the aggregated occupancy result.
  - Save to local storage.

### Local storage strategy
- Key: `cortex.solutionSnapshots` → array of snapshots.
- Operations:
  - `loadSnapshots`, `saveSnapshot`, `updateDescription`, `deleteSnapshot`, `clearAll`, `reorder`.
- Constraints & guardrails:
  - Limit to N snapshots (e.g., 5–8) to avoid quota issues.
  - Approximate size check; warn if nearing localStorage limits.
  - Backward compatibility via version field on snapshot.

### New page: Solution Comparison (`/solution-comparison`)
- Structure mirrors the Flow Evaluation page:
  - Header, hydration/user check, `TimeScaleControl`.
  - Local state: `snapshots` (loaded from LS), `selectedIds` (multi-select, ordered), `viewFrom`, `viewTo`, `tvScope` (‘aggregate’, ‘targets’, ‘ripples’), `minutesPerBin` handling, UI prefs.
  - Palette for snapshot columns and chart legend.

#### Controls
- Manage snapshots: multi-select, rename description inline, delete, reorder, import/export JSON.
- Time window: reuses `TimeScaleControl`; all stats and charts filter to `[viewFrom, viewTo]`.
- TV scope/toggles:
  - Aggregate (uses `post_counts`/`capacity`).
  - Targets/Ripples (uses `*_occupancy_opt` from per-flow data).
- TV selection:
  - Default to union of: controlled TVs, TVs in `tv_ids_order`, top-K by exceedance in window.
  - Allow search/filter and “Show more”.

#### Flight delays table
- Rows: union of flights across selected snapshots (keys from `delays_min`).
- Columns: one per snapshot (delay minutes).
- Resolve metadata (callsign, origin/dest, takeoff) via `useSimStore().flights` like `FlowsSummary`.
- Row features:
  - Highest delay cell in the row is highlighted.
  - Sorting: by max delay, by max diff between snapshots, by callsign.
  - Filters: only flights with any delay; threshold; by flow if available.
  - Sticky header, optional virtualization for large lists.

#### Objective comparison
- Cards/table:
  - Overall scores: baseline → optimized per snapshot with delta and % change.
  - Per-component rows (union of keys across snapshots): show values per snapshot; highlight best (lowest).
  - Optional small sparkline/badge for relative rank.

#### Occupancy multi-bar charts
- For each selected TV, render clustered bars for each snapshot (post-opt occupancy); overlay capacity line if present.
- Legend shows:
  - For each snapshot: color, Peak within window, Exceedance total (sum max(0, demand − capacity) across bins in window).
- Respect `viewFrom`/`viewTo`.
- Sorting of TVs within the section by exceedance, peak, or total.

### Time-bin alignment
- Prefer consistent `time_bin_minutes` across snapshots. If mismatched:
  - Phase 1: show a warning and allow comparison only among snapshots with matching bin sizes; gray out others.
  - Phase 2 (optional): resample to a common grid using a GCD-based step and sum/average per target bin for proper alignment.

### Performance considerations
- Memoize derived metrics per snapshot and view window.
- Virtualize the flight delays table for large unions.
- Limit visible TVs and provide pagination/“Show more.”

### Error and UX details
- If a snapshot lacks aggregated occupancy, allow partial comparison with a “No occupancy data” badge; offer “Fetch now” to retrofill by hitting `/api/autorate_occupancy` (if auth/session allows).
- If a flight id can’t be resolved to metadata, show token with a subtle warning icon.
- Provide unobtrusive toasts for “Saved to comparison”, “Deleted”, “Copied JSON”.

### Implementation steps
1. Types and utils
   - Define `SolutionSnapshot` (versioned) and LS helpers in `lib/comparison.ts`.
   - Derivation helpers: peak/exceedance within a time window; union/ordering of TVs; minutes-per-bin alignment checks.
2. Flow Evaluation page edits
   - Add “Add to Comparison” button and description prompt.
   - On confirm, ensure aggregated occupancy is available; build and save snapshot; toast.
3. New Comparison page (`src/app/solution-comparison/page.tsx`)
   - Load/manage snapshots from LS; multi-select; `TimeScaleControl` with shared state.
   - Flight delays table; objective comparison cards; occupancy charts with clustered bars.
   - TV scope + selection UI; legends and metrics.
4. Polishing
   - Color palette for snapshots; accessibility (focus, keyboard nav).
   - Warnings for bin mismatch and storage limits.
   - Optional import/export JSON.

### Confirmed decisions
- **Snapshot limit**: 4 max.
- **Bin alignment (v1)**: compare only snapshots with matching minutes-per-bin; show a mismatch warning and disable others.
- **Series stored**: post-optimization only.
- **Persistence**: localStorage only.
- **Comparison style**: side-by-side; label which snapshot is “better” per metric.
- **TVs shown**: all TVs “touched” by regulations, with ranking options.

### Snapshot content (post-opt only)
- **Meta**: id, createdAt, description, version, minutes_per_bin, source route, optional shareUrl.
- **Inputs**: payload summary (flows, targets, ripples), weights_used, sa_params_used.
- **Outcomes**:
  - Delays map: flightId → delay minutes.
  - Objective: optimized score and components.
  - Per-flow post series: `target_occupancy_opt`, `ripple_occupancy_opt` (rates if available).
  - Aggregated occupancy for charts: `post_counts`, `capacity`, `tv_ids_order`, `time_bin_minutes`.
- Store only what is needed for comparison; omit baseline series and pre-counts.

### Flow Evaluation page (`src/app/flow-evaluation/page.tsx`)
- Add an “Add to Comparison” button shown when `optState.data` exists.
- Click flow:
  - Prompt for description (default: timestamp + objective).
  - Ensure aggregated occupancy for post view is available; if not, fetch `/api/autorate_occupancy` once.
  - Build snapshot (post-opt only) and save to localStorage (limit 4; if full, ask to replace or cancel).
  - Toast: saved + CTA “Open Comparison”.
- Minor UI: badge showing current saved count (e.g., 2/4).

### Local storage API (no server)
- Key: `cortex.solutionSnapshots` → array of snapshots (max 4).
- Ops: load, add (with cap+LRU or explicit replace), rename, delete, clear, reorder, export/import JSON.
- Guardrails: rough size check; versioning for future compatibility.

### Comparison page (`src/app/solution-comparison/page.tsx`)
- Layout: Header, snapshot manager, TimeScaleControl, sections for Flights, Objectives, Occupancy.
- State: `snapshots`, `selectedIds` (1–4), `viewFrom`, `viewTo`, `minutesPerBin`.
- Bin alignment: compute common `minutesPerBin` among selected; if mismatch, disable non-matching with tooltip.

#### Snapshot manager
- List saved snapshots with color chips, description inline-edit, createdAt, optimized score.
- Multi-select up to 4; delete, reorder, export/import.
- Warning banner if any selected are bin-mismatched.

#### Time window
- Same `TimeScaleControl` as `flow-evaluation`; all stats and charts filter to `[viewFrom, viewTo]`.

#### Flights comparison table
- Rows: union of flights appearing in any selected snapshot’s delays map; resolve metadata via `useSimStore().flights`.
- Columns: one per snapshot showing delay minutes.
- Row highlight: highest delay cell per row.
- Per-row summary: max delay value and which snapshot it belongs to.
- Column footers: total delay, avg delay; mark “better” snapshot(s) in footer (lowest total/avg).
- Sorts: by max delay, by diff between best/worst, by callsign; filters: “only delayed”, threshold slider.
- Performance: sticky header; virtualize if needed.

#### Objective comparison
- Cards: per snapshot show optimized score; label “best” on lowest value.
- Components table: union of component keys across selected; one column per snapshot; highlight lowest per row; show % delta vs best.

#### Occupancy comparison (multi-bar per TV)
- TV set: union of “touched” TVs in each snapshot:
  - TVs present in per-flow `target_occupancy_opt` or `ripple_occupancy_opt`, and TVs in aggregated `tv_ids_order`.
- Ranking options: by exceedance sum (within window), by peak (within window), by total demand (within window), alphabetical.
- Chart per TV:
  - Clustered bars: one series per snapshot using post-opt counts; capacity line overlaid if present.
  - Legend per snapshot color with in-window metrics: Peak, Exceedance sum.
  - Tooltips respect window; show contributing snapshot and bin label.
- Controls: TV search, top-K selector, “Show more”.

### “Better” labeling rules
- Objective: lowest optimized score is better.
- Flights table: per row, highest cell highlighted (for visibility); per-column totals/avgs used to mark better snapshot(s) (lowest).
- Occupancy: for each TV, “better” is the snapshot with lowest exceedance sum; tie-handling via peak then total.

### Empty/error states
- No snapshots: informative empty state with CTA to `flow-evaluation`.
- Missing occupancy in a snapshot: show chart placeholders with “No occupancy data”; allow retrofill by fetching if session is active.
- Unresolved flights: show token, subtle warning icon.

### Acceptance criteria
- Save up to 4 snapshots; attempting to add a 5th prompts to replace or cancel.
- Comparison page renders side-by-side for all three sections within the selected time window.
- Highest delay cell highlighted per flight row; best snapshot clearly indicated per metric.
- TVs shown are the union of touched TVs; sorting works; charts respect time window.
- Mismatched bin snapshots are disabled with a clear warning.

### Next steps
- Define `SolutionSnapshot` type and LS helpers in a new `lib/comparison.ts`.
- Add “Add to Comparison” button + prompt + save flow in `flow-evaluation/page.tsx`.
- Build `src/app/solution-comparison/page.tsx` with sections above.
- QA with seeded snapshots; verify time-window filtering and “better” labels.

- Restrict to 4 snapshots max, post-opt only, localStorage only.
- Compare only matching bin sizes; warn/disable otherwise.
- TVs shown are union of “touched” TVs with ranking controls.