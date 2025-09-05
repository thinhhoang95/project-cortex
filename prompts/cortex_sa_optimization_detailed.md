### Goal
Integrate an Optimize button on `flow-evaluation` that:
- Calls backend POST `/automatic_rate_adjustment` via a Next API route.
- Preserves the existing baseline evaluation results.
- Renders baseline vs optimized comparisons:
  - Objective score and components with pre -> post and deltas.
  - Histograms: show per-time-bin multi-bar (baseline demand vs optimized realized occupancy) for each TV.
  - Stats under each histogram: Total, Peak (baseline vs optimized).

### Backend proxy (Next.js API)
- Add a new proxy route mirroring `api/base_evaluation`.

Create `src/app/api/automatic_rate_adjustment/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const body = await request.json().catch(() => ({}));

    const resp = await fetch(`${backendUrl}/automatic_rate_adjustment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: `Backend error: ${resp.status}`, details: text },
        { status: 502 }
      );
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('automatic_rate_adjustment proxy error', err);
    return NextResponse.json(
      { error: 'Failed to proxy automatic_rate_adjustment', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
```

### Types
- Extend `src/lib/models.ts` with response/flow types for `/automatic_rate_adjustment`.

```118:140:/mnt/d/project-cortex/src/lib/models.ts
export interface FlowOptResult {
  flow_id: number;
  controlled_volume: string | null;
  n0: number[];            // length T+1
  demand: number[];        // length T
  n_opt: number[];         // length T+1
  target_demands: Record<string, number[]>; // baseline earliest crossings
  ripple_demands?: Record<string, number[]>;
  target_occupancy_opt?: Record<string, number[]>; // realized occupancy post-optimization
  ripple_occupancy_opt?: Record<string, number[]>;
}

export interface AutomaticRateAdjustmentResponse {
  num_time_bins: number;
  tvs: string[];
  target_cells: Array<[string, number]>;
  ripple_cells?: Array<[string, number]>;
  flows: FlowOptResult[];
  objective_baseline: { score: number; components: Record<string, number> };
  objective_optimized: { score: number; components: Record<string, number> };
  improvement: { absolute: number; percent: number };
  weights_used?: Record<string, number>;
  sa_params_used?: Record<string, number>;
}
```

### UI state and API call
- In `src/app/flow-evaluation/page.tsx`:
  - Add optimization state, handler, and wire up the button.
  - Reuse the current payload (respecting `weightsOverride`), and keep baseline results intact.

Edits:
```144:170:/mnt/d/project-cortex/src/app/flow-evaluation/page.tsx
import { BaseEvaluationResponse } from "@/lib/models";
// add:
import { AutomaticRateAdjustmentResponse } from "@/lib/models";

type FetchState = { loading: boolean; error: string | null; data: BaseEvaluationResponse | null };
// add parallel opt state:
type OptFetchState = { loading: boolean; error: string | null; data: AutomaticRateAdjustmentResponse | null };

// ...
const [optState, setOptState] = useState<OptFetchState>({ loading: false, error: null, data: null });

// ...
const handleOptimize = async () => {
  if (!input) return;
  setOptState({ loading: true, error: null, data: null });
  try {
    const body: any = { ...input };
    if (!body.weights && weightsOverride && Object.keys(weightsOverride).length > 0) {
      body.weights = weightsOverride;
    }
    delete body.colorsByFlow;
    const res = await fetch("/api/automatic_rate_adjustment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed: ${res.status}`);
    }
    const json = (await res.json()) as AutomaticRateAdjustmentResponse;
    setOptState({ loading: false, error: null, data: json });
  } catch (e: any) {
    setOptState({ loading: false, error: e?.message || "Failed to run optimization", data: null });
  }
};
```

Wire the button:
```257:267:/mnt/d/project-cortex/src/app/flow-evaluation/page.tsx
<button
  onClick={handleOptimize}
  disabled={!input || evalState.loading || optState.loading}
  className={`px-3 py-1 rounded-lg border text-xs ${optState.loading ? 'border-purple-400/50 bg-purple-500/20 text-purple-200' : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
>
  {optState.loading ? <ShimmeringText text="Optimizing..." /> : "Optimize with The World's Best Optimization Algorithm: Simulated Annealing®"}
</button>
{optState.error && <div className="text-[11px] text-red-200">{optState.error}</div>}
```

Optional: add a small “Show Optimization Response” toggle alongside existing debug toggles.

### Objective comparisons
- If both baseline (from `evalState.data`) and optimization result exist, render pre -> post score and components with deltas. Keep the existing baseline-only summary when optimization hasn’t run.

Add a comparison block (place under the existing Objective section or replace it conditionally):
```480:562:/mnt/d/project-cortex/src/app/flow-evaluation/page.tsx
{!!evalState.data?.objective && !optState.data && (
  /* existing Objective UI (baseline only) stays as-is */
)}
{evalState.data?.objective && optState.data && (
  <section className="mb-8">
    {(() => {
      const b = optState.data!.objective_baseline;
      const o = optState.data!.objective_optimized;
      const compKeys = Array.from(new Set([...Object.keys(b.components||{}), ...Object.keys(o.components||{})])).sort();
      const fmt = (x: number) => Number.isFinite(x) ? x.toFixed(1) : "0.0";
      const delta = b.score - o.score;
      const pct = (delta * 100) / (b.score || 1);
      return (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Objective Score</div>
            <div className="text-xl text-white">
              {fmt(b.score)} → {fmt(o.score)}
              <span className={`ml-2 text-sm ${delta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                ({delta >= 0 ? '−' : '+'}{Math.abs(delta).toFixed(1)}, {delta >= 0 ? '−' : '+'}{Math.abs(pct).toFixed(2)}%)
              </span>
            </div>
            <div className="text-[12px] text-white/60 mt-1">Lower is better</div>
          </div>
          {compKeys.map((k) => {
            const vb = Number(b.components?.[k] ?? 0);
            const vo = Number(o.components?.[k] ?? 0);
            const d = vb - vo;
            const p = (d * 100) / (vb || 1);
            return (
              <div key={k} className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">{k}</div>
                <div className="text-white">
                  {fmt(vb)} → {fmt(vo)}
                  <span className={`ml-2 text-[12px] ${d >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    ({d >= 0 ? '−' : '+'}{Math.abs(d).toFixed(1)}, {d >= 0 ? '−' : '+'}{Math.abs(p).toFixed(1)}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      );
    })()}
  </section>
)}
```

### Histogram multi-bar comparisons
- Compare baseline “demand” vs optimized “realized occupancy” for each TV:
  - Targets: baseline `target_demands[tvId]` vs optimized `target_occupancy_opt[tvId]`.
  - Ripples: baseline `ripple_demands[tvId]` vs optimized `ripple_occupancy_opt[tvId]`.
- Keep highlight behavior (attention cells) as-is.

1) Pass optimized seriesB into existing cards:
```574:680:/mnt/d/project-cortex/src/app/flow-evaluation/page.tsx
{evalState.data?.flows?.map((flow, idx) => {
  const optFlow = optState.data?.flows?.find(f => f.flow_id === flow.flow_id);
  // ...
  // Targets
  // ...
  return (
    <div key={`flow-${idx}`} className="mb-8">
      {/* ... */}
      <div className="mb-4">
        <div className="text-sm uppercase tracking-wider text-gray-300 mb-2">Targets</div>
        {/* ... */}
        {list.map((tvId) => (
          <HistogramCard
            key={`t-${flow.flow_id}-${tvId}`}
            tvId={tvId}
            series={targets[tvId] || []}
            seriesB={optFlow?.target_occupancy_opt?.[tvId] || null}
            minutesPerBin={minutesPerBin}
            viewFrom={viewFrom}
            viewTo={viewTo}
            isControlled={controlledTv === tvId}
            showLabels={showLabels}
            attentionSet={targetHighlights}
            markerColor="#f59e0b"
          />
        ))}
        {/* ... */}
      </div>
      {/* Ripples */}
      {/* ... */}
      <HistogramCard
        key={`r-${flow.flow_id}-${tvId}`}
        tvId={tvId}
        series={ripples[tvId] || []}
        seriesB={optFlow?.ripple_occupancy_opt?.[tvId] || null}
        minutesPerBin={minutesPerBin}
        viewFrom={viewFrom}
        viewTo={viewTo}
        isControlled={false}
        showLabels={showLabels}
        attentionSet={rippleHighlights}
        markerColor="#c084fc"
      />
      {/* ... */}
    </div>
  );
})}
```

2) Upgrade `HistogramCard` to accept and render an optional second series:
```818:902:/mnt/d/project-cortex/src/app/flow-evaluation/page.tsx
function HistogramCard({ tvId, series, seriesB, minutesPerBin, viewFrom, viewTo, isControlled, showLabels, attentionSet, markerColor }: {
  tvId: string;
  series: number[];
  seriesB?: number[] | null; // optimized occupancy
  minutesPerBin: number;
  viewFrom: string;
  viewTo: string;
  isControlled: boolean;
  showLabels: boolean;
  attentionSet: Set<string>;
  markerColor?: string;
}) {
  const rows = useMemo(() => {
    const n = Math.max(series.length, Array.isArray(seriesB) ? seriesB.length : 0);
    const arr = new Array(n).fill(0).map((_, i) => {
      const startMin = i * minutesPerBin;
      const vA = Number(series[i] ?? 0);
      const vB = Number(Array.isArray(seriesB) ? seriesB[i] ?? 0 : 0);
      const isAttention = attentionSet.has(`${tvId}|${i}`);
      return { idx: i, valueA: vA, valueB: vB, startMin, isAttention };
    });
    const vFrom = hhmmToMinutesSafe(viewFrom);
    const vTo = hhmmToMinutesSafe(viewTo);
    return arr.filter((r) => r.startMin >= vFrom && r.startMin <= vTo);
  }, [series, seriesB, minutesPerBin, attentionSet, tvId, viewFrom, viewTo]);

  const totalA = useMemo(() => series.reduce((s, v) => s + (Number(v) || 0), 0), [series]);
  const peakA = useMemo(() => {
    let bestIdx = -1; let bestVal = -Infinity;
    for (let i = 0; i < series.length; i++) { const v = Number(series[i] || 0); if (v > bestVal) { bestVal = v; bestIdx = i; } }
    return { idx: bestIdx, value: bestVal };
  }, [series]);
  const totalB = useMemo(() => (Array.isArray(seriesB) ? seriesB : []).reduce((s, v) => s + (Number(v) || 0), 0), [seriesB]);
  const peakB = useMemo(() => {
    const s = Array.isArray(seriesB) ? seriesB : [];
    let bestIdx = -1; let bestVal = -Infinity;
    for (let i = 0; i < s.length; i++) { const v = Number(s[i] || 0); if (v > bestVal) { bestVal = v; bestIdx = i; } }
    return { idx: bestIdx, value: bestVal };
  }, [seriesB]);

  const attentionSum = useMemo(() => rows.reduce((s, r) => s + (r.isAttention ? r.valueA : 0), 0), [rows]);

  return (
    <div className={`rounded-xl p-3 ${isControlled ? 'border-rose-400/70' : 'border-white/10'} bg-white/5 border`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-white flex items-center gap-2">
          {isControlled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-400/70 text-rose-200">Controlled</span>}
          {markerColor && <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: markerColor }} />}
          <span>{tvId}</span>
        </div>
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="idx"
              tick={showLabels ? { fontSize: 10 } : false}
              axisLine={true}
              tickLine={true}
              hide={false}
              interval="preserveStartEnd"
              tickFormatter={(value: any) => binIndexToRangeLabel(Number(value ?? 0), minutesPerBin)}
            />
            <YAxis tick={{ fontSize: 10 }} axisLine={true} tickLine={true} width={32} />
            <Tooltip
              wrapperStyle={{ zIndex: 20 }}
              contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
              itemStyle={{ color: 'white' }}
              labelStyle={{ color: 'white' }}
              labelFormatter={(labelIdx: any) => binIndexToRangeLabel(Number(labelIdx ?? 0), minutesPerBin)}
              formatter={(val: any, name: any) => [String(val), name === 'valueA' ? 'Baseline' : 'Optimized']}
            />
            <Bar dataKey="valueA" name="Baseline" fill="#60a5fa" />
            {Array.isArray(seriesB) && <Bar dataKey="valueB" name="Optimized" fill="#22c55e" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-white/80">
        <div>
          Total:
          <span className="font-mono text-white/90 ml-1">{totalA}</span>
          {Array.isArray(seriesB) && <span className="ml-1">→ <span className="font-mono text-white/90">{totalB}</span></span>}
        </div>
        <div>
          Peak:
          <span className="font-mono text-white/90 ml-1">{Number.isFinite(peakA.value) ? peakA.value : 0}</span>
          {Array.isArray(seriesB) && (
            <span className="ml-1">
              → <span className="font-mono text-white/90">{Number.isFinite(peakB.value) ? peakB.value : 0}</span>
            </span>
          )} @{peakA.idx >= 0 ? binIndexToRangeLabel(peakA.idx, minutesPerBin) : '--'}
        </div>
        <div>Attention sum: <span className="font-mono text-white/90">{attentionSum}</span></div>
      </div>
    </div>
  );
}
```

Notes:
- Baseline “occupancy” is the demand series (earliest crossings) because there are no delays; optimized uses realized occupancy. This aligns with the API’s Notes section.

### Preserving baseline and aligning bins
- Keep `evalState.data` untouched after optimization runs.
- Use `minutesPerBin` from baseline if available, otherwise fall back to `optState.data?.num_time_bins`.
- Only render seriesB when an optimized series is present for that TV.

### Optional: SA parameters UI (future)
- Add a small Advanced panel to set `iterations`, `seed`, `attention_bias`, etc., and include under `sa_params` in the optimization body. Default to not sending `sa_params` so backend defaults apply.

### Error/loading UX
- Disable Optimize while baseline is loading.
- Show errors from the optimization call inline next to the button.
- Add a “Show Optimization Response” debug toggle similar to “Show Response”.

### Test plan
- Build a basket with 1–3 flows and 1–2 target TVs, run “Run Evaluation.”
- Click “Optimize …” and verify:
  - Objective card shows baseline → optimized with negative delta and percent improvement.
  - Each Target/Ripple histogram shows two bars per bin.
  - Totals and Peaks show baseline → optimized.
  - Controlled volume badges remain correct.
- Edge: Unknown TVs/flight IDs in payload are ignored gracefully; verify response still renders.
- Edge: If `seriesB` missing for some TV, card renders baseline only.

### Work breakdown
- Add API proxy `api/automatic_rate_adjustment`.
- Add types in `src/lib/models.ts`.
- Update `flow-evaluation/page.tsx`:
  - Add opt state + handler; wire Optimize button.
  - Add objective comparison block.
  - Pass optimized seriesB into histogram rendering.
  - Extend `HistogramCard` to multi-bar + stats.

- Keep existing features (shareable URL, weight overrides, time-range control) unchanged.

- Acceptance criteria:
  - Optimize button triggers backend, displays objective pre→post with delta.
  - Histograms compare baseline demand vs optimized occupancy per TV.
  - Baseline-only behavior unchanged when optimization hasn’t run.

- Rollback: If needed, remove `seriesB` prop and objective comparison block; baseline flow continues to operate normally.

- Deployment: Requires BACKEND_URL to be set if not `http://localhost:8000`.

- Time estimate: ~0.5 day for wiring/types/UI compare, ~0.5 day polish and QA.

- Risks: Mismatch of time bins between baseline/optimized; handle by guarding lengths as shown.

- Future: Add `n0` vs `n_opt` visualization per flow; toggle diff modes (overlay vs grouped).

- Files touched:
  - Add `src/app/api/automatic_rate_adjustment/route.ts`.
  - Edit `src/lib/models.ts`.
  - Edit `src/app/flow-evaluation/page.tsx`.

Summary:
- New API proxy and TS interfaces for `/automatic_rate_adjustment`.
- Optimize button now calls the proxy, preserves baseline.
- Objective block shows baseline → optimized with deltas.
- Histograms upgraded to grouped bars (baseline demand vs optimized occupancy) with per-card totals/peaks.