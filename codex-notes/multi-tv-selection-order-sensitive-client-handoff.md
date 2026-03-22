# Multi-TV Selection Order: Client-Side Traversal Handoff

## What changed
- Multi-TV intersection lists now apply a second-pass client-side traversal-order filter after the existing membership intersection.
- The selected TV order is taken from `selectedTrafficVolumes`.
- A flight is kept only if its known per-TV times are non-decreasing in the selected order.

Example:
- Selected TVs: `A, B, C`
- Flight times: `A=10:00`, `B=10:12`, `C=10:28` -> kept
- Flight times: `A=10:20`, `B=10:05`, `C=10:28` -> removed

## Shared helper
- Helper: `matchesSelectedTvTraversalOrder(...)`
- File: `src/lib/airspaceInfoMultiTv.ts`

Rule:
- For each selected TV, derive a comparable time from:
  - `arrivalSeconds`, else
  - `windowStartSeconds`
- Ignore TVs with no comparable time
- Reject the row if a later selected TV has a smaller comparable time than an earlier selected TV
- Keep the row otherwise

This is intentionally best-effort:
- missing timing data does not exclude the row
- equal times are allowed

## Call sites updated
- `src/components/AirspaceInfo.tsx`
- `src/components/FlowAirspaceView.tsx`
- `src/components/RegulationFlightListLeftPanel2.tsx`
- `src/components/RerouteTvBaseListSync.tsx`

Effect by area:
- Monitoring right panel flight list now reflects selection order
- Flow flight list now reflects selection order
- Regulation left flight list now reflects selection order
- Reroute base list derived from selected TVs now reflects selection order

## Important caveats
- This is still built on top of per-TV single-endpoint fan-out.
- We are not asking the backend for a true multi-TV ordered path query.
- Correctness depends on the quality and completeness of the per-TV payloads.

Known limitations:
- If `tv_flights_ordered` is truncated around `ref_time_str`, a valid later-TV hit may be missing and the flight can be dropped.
- On the regulations page, the primary candidate universe is still capped by the ranking endpoint (`top_k=500`) before intersection/order filtering.
- If a flight can traverse the same TV multiple times but the payload exposes only one arrival, the client may compare the wrong occurrence.
- Legacy payloads only provide time-window starts, so ordering is coarser there.

## Why this stayed client-side
- The user explicitly chose the client fix as good enough.
- For the current UX, the main need was to distinguish `A -> B` from `B -> A` in intersection-style lists.
- Existing payloads already provide enough timing metadata in the common case to do this locally.

## When to revisit the backend
- If we need backend-guaranteed semantics for ordered traversal
- If we need complete candidate universes instead of time-local/truncated snapshots
- If we need to model repeated visits to the same TV
- If order-sensitive regulation candidate generation becomes a hard requirement

Likely backend shape if revisited later:
- accept ordered TV ids as a list
- return flights that satisfy that ordered path
- return per-flight per-TV passage events from one backend computation

## Verification completed
- `npx vitest run src/lib/airspaceInfoMultiTv.test.ts`
- `npx tsc --noEmit`
