# Regulation Results Per-ACC Attribution Feature Notes

## Why this exists
These notes capture implementation details and tradeoffs from adding per-ACC delay attribution to the regulation simulation results dialog (`RegulationPlanPanel` -> store -> `RegulationResults`).

This is useful if we need to:
- add similar "mode-switch + refetch" result widgets in other dialogs/pages,
- extend ACC attribution (tables/export/snapshot support),
- or refactor simulation request building shared across components.

## What was implemented (high level)
- The regulation simulation request now sends `per_acc_attrib_mode` (default `dwelling_spread`) and explicit `tv_kind: "as"`.
- The results dialog (`RegulationResults`) can switch attribution mode (`dwelling_spread` / `control_volume`) and re-run the simulation from inside the modal.
- A new `ACC Delay Attribution` section was added before airport attribution:
  - mode selector
  - inline loading/error states
  - summary stats (when metadata exists)
  - vertical bar chart of delay minutes by ACC

## Key architecture decision (important)
### The modal re-runs the simulation itself
`RegulationResults` is mounted from `RegulationCanvas`, but the initial simulation is triggered from `RegulationPlanPanel`.

To avoid threading new callbacks through multiple components, the modal:
- reads `regulations` and `flights` from the shared Zustand store
- calls the same simulation helper as the panel
- updates the shared `regulationSimulationResult` store value

Why this works well:
- no prop-drilling changes
- result refresh stays consistent with how the dialog already reads shared state
- easy to reuse for future "refresh result with different options" controls

## Shared request helper pattern (reusable)
### New helper: `src/lib/regulationPlanSimulation.ts`
This helper centralizes:
- payload construction (`buildRegulationPlanSimulationPayload`)
- 15-min bin conversion (`computeRegulationTimeWindowBins`)
- callsign/id -> `target_flight_ids` normalization
- authenticated API call (`simulateRegulationPlan`)

Why this matters:
- before this change, request payload logic lived inline in `RegulationPlanPanel`
- adding modal refetch would have duplicated mapping/bin logic
- shared helper prevents drift across callers

If you add a similar feature elsewhere:
- reuse the helper instead of rebuilding request payloads in UI components
- prefer passing only UI state (`regulations`, `flights`, mode options) and let the helper shape API payloads

## Request payload notes (backend compatibility)
### What we send now
- `regulations` (structured objects)
- `weights` (legacy `alpha/beta/gamma/delta`, preserved from previous behavior)
- `tv_kind: "as"` (explicit instead of relying on backend default)
- `include_excess_vector: false`
- `per_acc_attrib_mode`

### What we intentionally stopped sending
- `top_k`

Reason:
- API marks `top_k` deprecated/ignored
- frontend no longer needs to depend on deprecation compatibility

### Callsign/ID mapping behavior (unchanged semantics)
The helper tries:
1. exact `flightId` match
2. exact `callSign` match
3. passthrough token if unresolved

This preserves previous behavior and avoids hard failures when the UI list is stale/incomplete.

## Type model updates (backward-compatible)
### `src/lib/models.ts`
Added:
- `RegulationPlanPerAccAttribMode`
- `RegulationPlanPerAccAttribMetadata`
- `RegulationPlanPerAccAttrib`
- optional `per_acc_attrib` on `RegulationPlanSimulationResponse`

Design choice:
- keep new fields optional so older backend responses do not crash the UI
- metadata fields are optional/loose because the backend may evolve fields over time

If extending:
- preserve optionality unless backend contract is fully enforced across environments
- prefer additive changes to response types (avoid making legacy fields stricter)

## UI behavior decisions (intentional)
### Placement in the dialog
ACC attribution is shown immediately before airport attribution.

Reason:
- both are "delay attribution" views
- keeps attribution concepts grouped without crowding top-level delay/objective summaries

### Mode switch behavior
When the user changes attribution mode:
- selector disables while request is in flight
- prior result stays visible (no dialog reset/flicker)
- on success: replace the entire simulation result in store
- on failure: show inline error and revert selector to the mode of the currently displayed result

This is the right UX pattern for expensive simulation refreshes and is reusable elsewhere.

### Why we replace the entire result (not just `per_acc_attrib`)
The endpoint returns a full simulation response and may recompute more than attribution.

We intentionally replace the full result because:
- it keeps UI state consistent with the actual backend response
- it avoids subtle mismatches (e.g., attribution mode metadata vs objective/delay payload from a previous run)

If a future backend adds a lightweight attribution-only endpoint, this can be optimized.

## ACC chart implementation notes (Recharts)
### Chart design choices
- `BarChart` with `layout="vertical"` for readable ACC labels
- single series: delay minutes
- sorted descending by delay, then ACC code
- dynamic chart height based on row count
- scroll container when many ACCs exist

Why vertical bars:
- ACC labels are short but still easier to scan on y-axis
- supports many rows better than horizontal x-axis category labels

### Data normalization
We convert `per_acc_attrib.delay_minutes_by_acc` to chart rows and:
- coerce numeric values with `Number(...)`
- drop non-finite values
- fallback ACC label to `"UNK"` if blank

If copying this pattern:
- always sanitize API maps before charting; `Recharts` can behave badly with `NaN`/`undefined`

## Store/result synchronization gotchas
### Source of truth for selector state
The selector state is synced from `result.per_acc_attrib.mode` whenever `result` changes.

Why this matters:
- the displayed result is the source of truth, not the last local selection attempt
- prevents selector drift after failed requests or external result updates

### In-flight request/race handling
Current implementation disables the selector during refresh (`perAccAttribLoading`) to serialize requests.

This avoids most race conditions without introducing `AbortController`.

If you add more toggles or concurrent refresh sources later:
- consider request IDs or cancellation to prevent out-of-order updates

## Failure/compatibility handling (important)
### Missing `per_acc_attrib`
The UI shows a fallback message instead of crashing:
- "ACC attribution is unavailable..."

This matters because:
- different backend versions/environments may not return `per_acc_attrib`
- partial rollout/backward compatibility is common in this app

### Empty attribution map
If `delay_minutes_by_acc` is present but empty:
- summary cards still show metadata (if present)
- chart area shows "No ACC delay attribution to visualize."

### Simulation failures during mode switch
We keep the old result visible and show inline error.

Do not blank or clear `regulationSimulationResult` on refresh failure.

## Interaction with other existing features
### Snapshot/comparison feature
No snapshot schema changes were made.

Current behavior:
- snapshot saving in `RegulationResults` still works
- `per_acc_attrib` is not persisted into comparison snapshots

If we want per-ACC comparison later:
- extend snapshot schema in `src/lib/reg-comparison.ts`
- consider bumping snapshot version if the stored shape changes materially

### Airport attribution section
No logic changes were made to airport attribution.

This was intentional to reduce regression risk while adding a new attribution view.

## Files that matter for this feature
- `src/lib/models.ts`
- `src/lib/regulationPlanSimulation.ts` (new shared helper)
- `src/components/RegulationPlanPanel.tsx`
- `src/components/RegulationResults.tsx`
- `src/components/useSimStore.ts` (existing store interface; reused setters/state)
- `src/app/api/regulation_plan_simulation/route.ts` (no code changes needed; already forwards payload fields)

## Implementation details I would reuse for similar features
### Pattern: "results modal adds a new backend-driven mode switch"
Use this pattern:
1. Add optional typed response field(s) to `models.ts`
2. Extract shared request builder/helper if request construction is duplicated
3. Keep modal result visible during refresh
4. Store local selector/loading/error state in the modal
5. Sync selector from the actual `result` payload after refresh
6. Revert selector on error to the displayed result's mode
7. Add explicit empty/fallback UI for missing backend fields

This pattern is safer than pushing every toggle into global store first.

## Validation notes (repo-specific)
### Linting
- `npm run lint` currently fails due unrelated pre-existing repo errors/warnings
- use targeted lint verification for touched files via `next lint --file ...`

This is worth remembering when implementing similar scoped changes.

## Extension ideas / next improvements
- Add an ACC attribution table (sortable/exportable) under the chart for precise values.
- Add a chart metric toggle (delay minutes vs share of attributed delay).
- Add `tv_kind` selector in the UI if users need `nonas` / `any`.
- Persist selected ACC attribution mode in store or local storage if users revisit the modal often.
- Add snapshot/comparison support for `per_acc_attrib` if cross-plan attribution comparison becomes a use case.
- Introduce `AbortController` for modal refetch if multiple result controls are added.
- If multiple pages need this, move helper + UI refresh logic into a reusable hook (e.g. `useRegulationSimulationRefresh`).

## Manual regression checklist (copy/paste next time)
- Initial simulate request includes `per_acc_attrib_mode`
- `top_k` is not sent
- Results dialog still opens normally
- Switching mode triggers one new API call and disables selector while pending
- Success updates chart + metadata
- Failure keeps old result visible and shows inline error
- Missing `per_acc_attrib` response does not crash dialog
- Airport attribution and delay table still render unchanged
