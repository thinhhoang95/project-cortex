# Flight Catcher Consistency Notes

## Ownership
- Shared catcher policy and mutation logic lives in [src/lib/flightCatcherPolicy.ts](/Volumes/CrucialX/project-cortex/src/lib/flightCatcherPolicy.ts).
- Canvas components are adapters:
  - [src/components/RegulationCanvas.tsx](/Volumes/CrucialX/project-cortex/src/components/RegulationCanvas.tsx)
  - [src/components/FlowCanvas.tsx](/Volumes/CrucialX/project-cortex/src/components/FlowCanvas.tsx)
  - [src/components/MapCanvasReroute.tsx](/Volumes/CrucialX/project-cortex/src/components/MapCanvasReroute.tsx)

## Core invariants
- A catcher gate freezes at first click.
- Catcher matching uses the frozen gate time, not the completion time.
- A catcher can only affect flights visible when the gate is created.
- `tv_baseline` mode is constrained to a fixed list and cannot add new rows.
- `visible_only` mode can add/remove rows based on visible airborne lines at gate start.

## UI behavior
- TV-selected contexts keep checkbox eligibility rows (unchecked rows remain in list).
- No-TV reroute context removes rows explicitly (no checkbox toggling semantics).
- Panel copy should always state:
  - first-click freeze behavior
  - baseline limitation in TV mode

## Maintenance rule
- Do not implement catcher mutations directly in component event handlers.
- Use policy helpers (`freezeGateSnapshot`, `filterCapturedToGate`, `applyCatcherToRegulationTargets`, `applyCatcherToRerouteState`) to avoid drift.
