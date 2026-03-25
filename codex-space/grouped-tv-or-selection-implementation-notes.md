# Grouped TV OR Selection Implementation Notes

## Why this exists
These notes capture the implementation details behind adding grouped OR semantics to traffic-volume selection.

The feature extends the existing multi-TV selection model from a flat ordered list:
- before: `A AND B AND C`
- after: `A AND (B OR C) AND D`

This document focuses on:
- the actual state model now in the app,
- the important invariants that still exist,
- the behavior that was intentionally chosen,
- and the caveats discovered while tracing the existing code paths.

## Short version
- Selection state is now modeled as an ordered list of clauses in `selectedTrafficVolumeClauses`.
- Each clause is OR.
- Clause order is AND.
- Plain click appends a new AND clause.
- `Ctrl`/`Cmd` click appends to the current trailing clause as OR.
- Existing TVs still toggle off when clicked again.
- The first selected TV remains the primary/reference TV for the parts of the app that are still primary-scoped.

Example:
- clicks: `A`, `B`, `Ctrl+C`, `D`
- clauses: `[[A], [B, C], [D]]`
- expression: `A AND (B OR C) AND D`

## Research context / what mattered when tracing the code
Before making the change, the important thing to understand was that the app already had a strong primary-TV concept even after the original multi-TV work:
- `selectedTrafficVolume` is still widely used as the primary/reference TV.
- `selectedTrafficVolumes` was a flat ordered compatibility list.
- multiple panels already depended on “primary TV first, secondary TVs after that”.
- summary widgets, rate defaults, proposal/edit flows, and several reroute/regulation behaviors are intentionally primary-TV scoped.

The grouped OR design had to fit into that existing model rather than replace it wholesale.

Three existing notes were especially useful context:
- `codex-space/multi-tv-selection-implementation-notes.md`
- `codex-space/multi-tv-selection-regulations-implementation-notes.md`
- `codex-notes/multi-tv-selection-order-sensitive-client-handoff.md`

Those notes made two constraints clear:
- there is no dedicated backend multi-TV query model yet; the UI still fans out across single-TV endpoints,
- and the client already performs best-effort ordered traversal filtering using per-TV timing data.

That is why this implementation adds grouped selection semantics on the client instead of introducing a new backend API contract.

## Core state model
Primary helper file:
- `src/lib/multiTrafficVolumeSelection.ts`

New selection model:
- `selectedTrafficVolumeClauses: string[][]`

Meaning:
- outer array order = AND order
- inner array members = OR choices within that clause

Examples:
- `[[A]]` => `A`
- `[[A], [B]]` => `A AND B`
- `[[A], [B, C]]` => `A AND (B OR C)`
- `[[A], [B, C], [D]]` => `A AND (B OR C) AND D`

Compatibility state is still maintained:
- `selectedTrafficVolume`
- `selectedTrafficVolumes`
- `selectedTrafficVolumeData`

Important invariants that still matter:
- `selectedTrafficVolume === selectedTrafficVolumes[0] ?? null`
- `selectedTrafficVolume` is still the primary/reference TV
- `selectedTrafficVolumes` is the flattened clause order
- `selectedTrafficVolumeData` still corresponds to the primary TV
- TV selection and collapsed-sector selection remain mutually exclusive

## Selection behavior that was implemented
Main helper:
- `toggleTrafficVolumeSelectionClauses(...)`

Behavior:
- plain click creates a new trailing singleton clause
- `Ctrl`/`Cmd` click appends to the trailing clause as OR
- clicking an already-selected TV removes it from its current clause
- empty clauses collapse automatically
- max selected distinct TVs remains 5

Examples:
- `A` -> `[[A]]`
- `A`, `B` -> `[[A], [B]]`
- `A`, `B`, `Ctrl+C` -> `[[A], [B, C]]`
- `A`, `B`, `Ctrl+C`, `D` -> `[[A], [B, C], [D]]`
- `A`, `B`, `Ctrl+C`, click `B` again -> `[[A], [C]]`

## Important intentional limitation
This is the biggest nuance in the feature.

`Ctrl`/`Cmd` does **not** create an OR group immediately from the very first clause.

Current behavior:
- `A`, `Ctrl+B` => `A AND B`

Not:
- `A OR B`

Why this was chosen:
- too much of the app still assumes the first selected TV is the stable primary/reference TV,
- primary-row generation often starts from the first TV and then filters secondaries,
- regulation/reroute/proposal flows still use the primary TV as the authoritative scope,
- letting the first clause become multi-member OR would require a deeper rethink of how “primary TV” is defined.

The code comment for this is in:
- `src/lib/multiTrafficVolumeSelection.ts`

If first-clause OR is needed later, it should be treated as a larger follow-up, not a small tweak.

## Grouped matching semantics
Primary shared helper file:
- `src/lib/airspaceInfoMultiTv.ts`

The old flat logic already had:
- intersection across selected TVs,
- then best-effort ordered traversal filtering.

That logic now works by clause:
- union memberships within each clause,
- intersection across clauses,
- ordered traversal satisfied if there exists one member per clause whose comparable times are non-decreasing.

In practical terms:
- membership: `A AND (B OR C)` means the flight must be in `A` and also in either `B` or `C`
- ordering: a flight passes if at least one valid path through the OR clause preserves order

Example:
- clauses: `[[A], [B, C], [D]]`
- valid times: `A=10:00`, `B=09:50`, `C=10:20`, `D=10:40`
- result: valid, because `A -> C -> D` preserves order even though `A -> B -> D` does not

Comparable time selection is unchanged:
- use `arrivalSeconds` first
- otherwise fall back to `windowStartSeconds`
- missing timing data stays best-effort and does not automatically exclude the row

## Where the modifier-based selection was wired
Canvas click handlers now dispatch selection mode:
- `src/components/MapCanvas.tsx`
- `src/components/FlowCanvas.tsx`
- `src/components/RegulationCanvas.tsx`
- `src/components/MapCanvasReroute.tsx`

Behavior:
- plain click => `"and"`
- `Ctrl`/`Cmd` click => `"or"`

Intentional non-change:
- search/hotspot/other append flows still use the existing plain AND behavior
- this keeps the first iteration scoped to direct TV click interactions

## Main consumers updated
These components now derive grouped clauses and render grouped expressions:
- `src/components/AirspaceInfo.tsx`
- `src/components/FlowAirspaceView.tsx`
- `src/components/RegulationPanel.tsx`
- `src/components/RegulationFlightListLeftPanel2.tsx`
- `src/components/RerouteTvBaseListSync.tsx`
- `src/components/RerouteTvSelectionInfoPanel.tsx`

What changed in those consumers:
- they derive `selectedTvClauses` via `getEffectiveTrafficVolumeSelectionClauses(...)`
- they compute a clause-aware key instead of assuming the flat list is the real model
- they call `intersectSelectedTvClauseMemberships(...)`
- they call `matchesSelectedTvTraversalOrderClauses(...)`
- they render `formatTrafficVolumeSelectionExpression(...)` in the header
- copy that said “intersection” was updated to selection-oriented wording where needed

## Primary-TV scoping is still deliberate
This feature did **not** convert the whole UI into a fully symmetric grouped-selection system.

Still primary-scoped by design:
- current count / capacity summaries
- FL range display
- overload/rate/reference-TV behaviors
- regulation/edit/proposal paths that target a single TV
- ranking/sorting tie-breaks that depend on a primary TV

Still multi-selection scoped:
- grouped matching for flight lists
- grouped selection expression display
- map highlight across all selected TVs
- reroute base-list sync input set
- multi-TV chart/list matching logic

That split is intentional. The grouped OR feature is layered on top of the existing reference-TV model, not a replacement for it.

## What I found while digging through the code
### 1. The app already relied heavily on flattened compatibility state
A lot of components still read `selectedTrafficVolumes` only to answer one of these questions:
- is anything selected?
- what is the first/primary TV?
- which TVs should be highlighted?

Those readers did not all need to become clause-aware immediately.

That is why the store still maintains:
- `selectedTrafficVolumes` as the flattened order,
- `selectedTrafficVolume` as the first flattened item.

### 2. Some panels already depended on “primary rows + secondary filters”
This was especially clear in:
- `FlowAirspaceView`
- `RegulationFlightListLeftPanel2`
- `RerouteTvBaseListSync`

Those flows typically:
- fetch or rank the primary TV first,
- build candidate rows from the primary TV,
- then constrain/filter using secondary TVs.

That is another reason first-clause OR was not enabled.

### 3. There is still no backend truth for grouped selection
The app still fans out to:
- `/api/tv_count_with_capacity`
- `/api/tv_flights`
- and, on regulations, the primary ranking endpoint

So grouped OR correctness is still bounded by:
- per-TV payload completeness,
- time-local ordered payload truncation risk,
- and the primary top-K universe on some regulation paths.

This feature improves the client semantics, but it does not change those upstream limitations.

## Known caveats
### Backend/data caveats
- `tv_flights` may still be truncated around `ref_time_str`, which can hide a valid OR member
- legacy payloads still force coarse `windowStartSeconds` fallback
- regulation ranked lists are still bounded by primary `top_k`, so grouped results there are still a ranked subset, not a guaranteed full universe

### UX caveats
- the expression is visible in headers, but there is no clause-specific map styling
- all selected TVs still highlight the same way on the map
- `Shift` was not given a separate behavior; `Ctrl`/`Cmd` is the grouped-OR modifier

### Architecture caveats
- the grouped model is now the real source of truth, but flattened compatibility state still exists for older readers
- if someone later “simplifies” code back to `selectedTrafficVolumes.slice(1)` without checking clauses, they can silently reintroduce incorrect semantics

## Tests / verification
Added coverage in:
- `src/lib/multiTrafficVolumeSelection.test.ts`
- `src/lib/airspaceInfoMultiTv.test.ts`
- `src/components/useSimStore.resourceDate.test.ts`

Covered cases include:
- plain AND append
- OR append to trailing clause
- duplicate suppression
- removal and clause collapse
- max-limit enforcement
- clause formatting
- grouped union/intersection semantics
- ordered traversal with OR clauses
- store state mirroring

Verification completed locally:
- `npx tsc --noEmit`
- `git diff --check`

Verification not completed locally:
- Vitest suite run

Reason:
- local environment was missing the Rollup native package `@rollup/rollup-linux-x64-gnu`

## Files most central to this feature
- `src/lib/multiTrafficVolumeSelection.ts`
- `src/lib/airspaceInfoMultiTv.ts`
- `src/components/useSimStore.ts`
- `src/components/MapCanvas.tsx`
- `src/components/FlowCanvas.tsx`
- `src/components/RegulationCanvas.tsx`
- `src/components/MapCanvasReroute.tsx`
- `src/components/AirspaceInfo.tsx`
- `src/components/FlowAirspaceView.tsx`
- `src/components/RegulationFlightListLeftPanel2.tsx`
- `src/components/RegulationPanel.tsx`
- `src/components/RerouteTvBaseListSync.tsx`
- `src/components/RerouteTvSelectionInfoPanel.tsx`

## If this is revisited later
Most likely next steps:
- decide whether first-clause OR is worth the larger primary-TV refactor
- consider a backend endpoint that accepts grouped TV clauses directly
- add a shared clause-aware hook to reduce duplicate panel logic
- add UI affordances for grouped selection editing/removal beyond raw toggle-clicks
- consider explicit clause styling if grouped selection becomes a major workflow
