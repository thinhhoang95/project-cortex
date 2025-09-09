### Goals
- Consolidate map rendering logic into a shared, reusable “painter/renderer” so `MapCanvas.tsx`, `RegulationCanvas.tsx`, and `FlowCanvas.tsx` stay in sync.
- Keep performance optimizations centralized (RAF gating/throttling, binary search, fast bearing, diffed filter updates).
- Preserve flexibility for canvas-specific overlays (regulations, flows).

### Shared module design
- Create a single imperative renderer module in `src/lib/map/` (e.g., `MapRenderer`).
- Renderer owns:
  - Source/layer creation and lifecycle.
  - Plane position updates and filter updates.
  - Cached keys to avoid redundant map style work.
  - All perf utilities (segment index, bearing, throttling).
- Renderer is store-agnostic: canvases pass state snapshots or callbacks.

### API surface (high-level)
- Constructor: accepts `map`, `config` (which features to enable), and hooks for events.
- Methods:
  - `initBaseStyle(data)` adds sources/layers and precomputed feature collections.
  - `updateState(partialState)` idempotently applies changes (t, filters, visibility).
  - `setPlaying(isPlaying)` starts/stops internal RAF (or no-op if using external clock).
  - `destroy()` removes listeners and clears refs.
- Hooks:
  - `onFlightClick(flight)`, `onSectorClick(tvId, tvProps)` for UI to react.

### Data flow and state
- Keep datasets in store: `flights`, `sectors`, `waypoints`, `hotspots`.
- Precompute once in a helper and store:
  - Flight lines `FeatureCollection` (colored), waypoint `FeatureCollection`, sector centroids for labels.
- Renderer receives those precomputed FCs to avoid recomputation per canvas.
- Cross-canvas sync via `useSimStore`:
  - Single source of truth for `t`, `playing`, focus/selection, FL range, visibility toggles.
  - Each renderer subscribes to store slices or is fed updates via `updateState`.

### Clock ownership
- Prefer a single global clock (e.g., `SimClock`) that advances `t` in the store.
- Renderers only respond to `t` changes (no independent `tick()`).
- If keeping local RAF: designate exactly one renderer as “clock owner”; others render on-demand when store changes.

### Feature flags per canvas
- `MapCanvas`: base map, flight lines + labels (toggle), planes with callsigns (toggle), waypoints (toggle), TV labels/hover/highlight, hotspots.
- `RegulationCanvas`: adds regulation overlays (time windows, rate visuals); fewer labels by default.
- `FlowCanvas`: adds flow communities/groups coloring and interactions; custom highlight logic.
- Implement via `config`: enable/disable layer groups and provide plugin updaters for canvas-specific overlays.

### Internal renderer structure
- `utils.ts`: `segmentIndex`, `fastBearing`, key builders, centroid helpers.
- `sources.ts`: add base sources (`sectors`, `flight-lines`, `planes`, `waypoints`).
- `layers.ts`: define layer specs; apply initial visibility based on provided flags.
- `updater.ts`: minimal-diff state applier
  - `updatePlanes(t)` builds points, sets `planes` data (throttled).
  - `updateFilters(filterState)` recompute only when keys change.
  - `updateHotspots(...)`, `updateFlRange(...)`, `updateLabelsVisibility(...)`.
- `plugins/`: `regulation.ts`, `flows.ts` add specialized sources/layers and update methods.

### Migration steps
1) Extract perf helpers from `MapCanvas.tsx` into `src/lib/map/utils.ts`.
2) Extract layer/source creation into `src/lib/map/{sources,layers}.ts` using current layer IDs.
3) Build `MapRenderer` that:
   - Accepts precomputed FCs and init flags.
   - Implements current optimized update paths (throttle + cached filter/opacity keys).
4) Convert `MapCanvas.tsx` to:
   - Create map instance only.
   - Instantiate `MapRenderer` and wire to store (subscribe or `useEffect` calling `updateState`).
   - Remove local RAF if adopting global clock.
5) Repeat for `RegulationCanvas.tsx` and `FlowCanvas.tsx`, enabling their plugins.
6) Introduce a single `SimClock` (optional) to advance `t`; remove per-canvas RAFs.
7) Validate parity and performance; then delete duplicated logic from canvases.

### Performance considerations (centralized in renderer)
- Throttle plane updates (30 FPS) and pause when tab hidden or canvas offscreen (Page Visibility + optional IntersectionObserver).
- Binary search for segment lookup; fast bearing.
- Cache filter keys and line opacity to avoid redundant `setFilter`/`setPaintProperty`.
- Default heavy labels off; enable with zoom thresholds.
- Optional viewport culling for planes when datasets are huge.

### Testing and validation
- Visual parity across canvases (same time, focus, filters).
- Instrument counts: `setData` call rate, filter updates per second.
- CPU/GPU measurements before/after.
- Edge-cases: zero flights, extreme FL ranges, rapid toggling of focus/preview.

### Rollout plan
- Phase 1: Extract helpers + sources/layers, wire `MapCanvas` to `MapRenderer`.
- Phase 2: Add `SimClock`; switch `MapCanvas` to use it.
- Phase 3: Migrate `RegulationCanvas` and `FlowCanvas` with plugins.
- Phase 4: Tune throttling/visibility and finalize defaults.

- Shared `MapRenderer` to own sources/layers, updates, and perf logic.
- One clock (global or single owner); other canvases render on-demand.
- Canvas-specific overlays via plugins and config flags.
- Precompute and share FCs via store to avoid duplication.