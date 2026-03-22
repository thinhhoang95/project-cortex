# regulation_state_support vs main

Scope:
- Base branch: `main` at `c58f2a7`
- Branch head: `regulation_state_support` at `ef4cee2`
- Includes current uncommitted working tree edits in the same workspace

## Executive Summary

This branch is a broad platform update centered on resource-date-aware state management, regulation and reroute simulation workflows, and richer analytics for traffic-volume and SA/posthoc results. It adds several backend proxy routes, new shared data models, and substantial UI surfaces for selecting resource dates, navigating state history, previewing flight distributions, and inspecting reroute impact.

The main architectural theme is that the app now treats `resource_date` and state-history selection as first-class synchronization primitives. Most screens, caches, and derived views are now aware of the selected resource date and can invalidate or refuse to operate when the server context changes underneath them.

## Committed Changes Since `main`

### 1. Resource date and state-history infrastructure

- Added backend proxy routes for resource context and state history:
  - `GET /api/resource_context`
  - `POST /api/resource_context/select`
  - `GET /api/resource_state_history`
  - `POST /api/resource_state/select`
  - `POST /api/resource_state_history_commit`
- Introduced shared resource-state types and helpers in `src/lib/resourceStates.ts` for:
  - state summaries and history details
  - sync payload normalization
  - bundle date validation
  - applying cumulative delays to trajectories
- Added `src/lib/resourceContextClient.ts` and `src/lib/resourceStateSync.ts` to fetch, validate, and sync the active resource bundle from the server.
- Added `useResourceDateGuard` to force login, validate the selected resource date, reject out-of-sync contexts, and redirect to `/select-date` when the app cannot safely continue.
- Added `ResourceDateSelectorPanel` and `ResourceStateHistoryControl` so users can select a date and switch between state-history nodes from the UI.
- Expanded `useSimStore` to track:
  - selected resource date
  - selected/head/zero state IDs
  - state-history generation
  - selected-state cumulative delays
  - resource-state loading/error/pending flags
  - a resource-state epoch used to invalidate derived async work

### 2. Regulation planning, proposal conversion, and state commits

- Added `src/lib/regulationStateCommit.ts` to build commit payloads from simulation output and flow optimization output.
- The commit helper now canonicalizes flight IDs and callsigns, rejects conflicting delay assignments, and only commits integer minute delays.
- Added `src/lib/regulationProposalToPlan.ts` to derive a regulation draft from a proposal flow while enforcing resource-date context and valid time windows.
- Added `src/lib/regulationTargets.ts`, `src/lib/regulationPlanSimulation.ts`, and supporting tests to standardize regulation target handling and simulation output.
- Updated the regulation pages and panels to support a more complete commit/simulate flow, including selection handoff, state-backed plan edits, and result inspection.

### 3. Reroute impact simulation

- Added `src/lib/rerouteImpact.ts`, a large new simulation and normalization layer for reroute scenarios.
- The reroute model now supports:
  - committed move signatures
  - obstacle validation
  - funnel-aware scenario rejection
  - request grouping by scenario signature
  - response parsing for detoured segments, diagnostics, and capacity deltas
- Added the backend proxy route `POST /api/reroute_impact`.
- Added `RerouteImpactResults` to display:
  - rerouted-flight summary counts
  - changed traffic volumes
  - rolling-hour occupancy diffs
  - per-flight diagnostics
  - missing-flight reporting
- Updated the reroute canvases and proposal panels to surface impact-oriented previews and results.

### 4. Traffic-volume DCB glance and flight-level distribution

- Added `src/lib/tvDcbGlance.ts` and `POST /api/tv_dcb_glance` to fetch short-horizon DCB summaries for visible traffic volumes.
- Added `src/lib/trafficVolumeDcbGlanceMap.ts` to render the glance labels directly on the map and cache them by resource-state epoch and reference bin.
- Added `src/lib/flightLevelBinCounts.ts` plus `GET /api/tv_flight_level_bin_flights` to support flight previews by flight-level bin.
- Added `FlightLevelBinCountChart` to:
  - aggregate bins into selectable 1000/2000/3000/5000 ft groupings
  - preview affected flight IDs on hover
  - scope previews to the current time window when requested
- Updated the main airspace/flow/regulation map components to use the new DCB and flight-level helpers.

### 5. SA posthoc analytics and comparison tooling

- Added backend proxies for:
  - `POST /api/sa_posthoc_analysis`
  - `POST /api/sa_posthoc_occupancy`
- Added `src/lib/agentSaTypes.ts` and `src/lib/agentRuns.ts` to normalize SA analysis payloads and run references.
- Added `AgentSaResultSummaryPanel` as the primary posthoc analysis dashboard.
- Added supporting analytics panels:
  - `OdDelayAttributionPanel`
  - `PerAccDelayComparisonPanel`
  - `PerStageRewardPanel`
  - `TrafficVolumeReliefMap` updates
- These views now expose:
  - objective-history trends
  - convergence metrics
  - per-ACC attribution comparison
  - OD delay attribution
  - per-flight solution tables

### 6. Flight visibility, map rendering, and shared display logic

- Refactored `flightVisibility.ts` to separate active-in-range flight IDs from list-driven eligibility.
- Added and expanded shared display helpers in `airspaceDisplay.ts`, `mapUtils.ts`, `trajectoryRender.ts`, and related utilities.
- Updated `FlowCanvas`, `MapCanvas`, `MapCanvasReroute`, `PredictionsMapCanvas`, and `RegulationCanvas` to use the refined flight visibility logic and line derivation.
- Added tests around:
  - flight visibility
  - flight catcher policy
  - flight identity
  - resource dates and resource states
  - reroute impact
  - regulation state commit
  - flight-level bin counts

### 7. App shell, navigation, and docs

- Added `/select-date` as a dedicated date-selection entry point.
- Updated multiple app pages to be resource-date-aware and to guard against stale state.
- Added release-note and version plumbing changes.
- Added or updated branch notes in `codex-space/`, including `STATEMAN_API.md` and flight-level distribution notes.
- Added new component assets and icons for the updated UI.

## Uncommitted Local Edits

The working tree also contains local changes on top of the branch head. These are not committed yet, but they matter for the effective branch state.

- `src/components/AirspaceInfo.tsx`
  - The summary card now distinguishes single-TV `Current Count` from multi-TV `Intersection Count`.
  - The table footer now reports whether truncation is happening based on total rows rather than rendered rows.
- `src/components/FlowAirspaceView.tsx`
  - Same count semantics as above: multi-TV mode now reports intersection count, and list counts use the full row total.
- `src/components/RegulationPanel.tsx`
  - Multi-TV mode now labels the summary as `Intersection Count`.
- `src/components/RerouteTvSelectionInfoPanel.tsx`
  - Multi-TV mode now uses `rerouteBaseFlightIds.length` as the intersection count and updates the label accordingly.
- `src/components/RegulationPlanPanel.tsx`
  - Header copy changed from `Active Network` to `Measures`.
  - This edit also includes formatting cleanup in the panel markup.
- `src/components/ReleaseNotesDialog.tsx`
  - Release notes now show both the app version and codename.
- `src/lib/version.ts`
  - Version bumped from `2026.03.20` to `2026.03.23`.
  - Codename changed from `redemption` to `elegance`.

## Engineering Notes

- The biggest merge risk is the expanded shared state model around `resource_date` and `resource_state_*`. Anything that reads from `useSimStore` or caches async data should be checked against the new epoch and date-guard behavior.
- The reroute and SA analytics paths add substantial new surface area but are mostly additive. The main behavioral change is better validation and richer diagnostics, not a wholesale replacement of existing workflows.
- I did not run the test suite in this pass.
