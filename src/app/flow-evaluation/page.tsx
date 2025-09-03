"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import TimeScaleControl from "@/components/TimeScaleControl";
import ShimmeringText from "@/components/ShimmeringText";
import { BaseEvaluationResponse } from "@/lib/models";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";

type FlowInputPayload = {
  flows: Record<string | number, string[]>;
  targets: Record<string, { from: string; to: string }>;
  ripples?: Record<string, { from: string; to: string }>;
  indexer_path?: string;
  flights_path?: string;
  capacities_path?: string;
  weights?: Record<string, number>;
  // optional metadata for UI only
  colorsByFlow?: Record<string, string>;
};

type FetchState = { loading: boolean; error: string | null; data: BaseEvaluationResponse | null };

function decodePayloadParam(param: string | null): FlowInputPayload | null {
  if (!param) return null;
  try {
    // URL-safe base64 -> standard base64
    const b64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof window === "undefined" ? Buffer.from(b64, "base64").toString("utf-8") : atob(b64);
    const obj = JSON.parse(json);
    return obj;
  } catch (e) {
    console.warn("Failed to decode payload param", e);
    return null;
  }
}

function encodePayloadParam(obj: any): string {
  try {
    const json = JSON.stringify(obj);
    const b64 = typeof window === "undefined" ? Buffer.from(json, "utf-8").toString("base64") : btoa(json);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch (e) {
    return "";
  }
}

function hhmmToMinutesSafe(hhmm?: string): number {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(":").map((x) => Number(x));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  const total = Math.max(0, Math.min(1439, hh * 60 + mm));
  return total;
}

function minutesToHHMM(totalMinutes: number): string {
  const m = Math.max(0, Math.min(1439, Math.floor(totalMinutes)));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function binIndexToRangeLabel(binIdx: number, minutesPerBin: number): string {
  const startMin = binIdx * minutesPerBin;
  const endMin = startMin + minutesPerBin;
  return `${minutesToHHMM(startMin)}-${minutesToHHMM(endMin)}`;
}

function parseViewParam(v: string | null): { from: string; to: string } | null {
  if (!v) return null;
  const m = String(v).match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return null;
  return { from: m[1], to: m[2] };
}

export default function FlowEvaluationPage() {
  const sp = useSearchParams();
  const payloadParam = sp?.get("payload") || null;
  const autostart = (sp?.get("autostart") || "0") === "1" || !!payloadParam;
  const viewParam = parseViewParam(sp?.get("view") || null);

  const [input, setInput] = useState<FlowInputPayload | null>(() => decodePayloadParam(payloadParam));
  const [evalState, setEvalState] = useState<FetchState>({ loading: false, error: null, data: null });
  const [viewFrom, setViewFrom] = useState<string>(viewParam?.from || "00:00");
  const [viewTo, setViewTo] = useState<string>(viewParam?.to || "23:59");
  const [showDebug, setShowDebug] = useState<boolean>(false);
  const [showResponse, setShowResponse] = useState<boolean>(false);
  const [weightsOverride, setWeightsOverride] = useState<Record<string, number> | null>(null);
  const [showLabels, setShowLabels] = useState<boolean>(false);

  const minutesPerBin = useMemo(() => {
    const T = evalState.data?.num_time_bins;
    if (!T || !Number.isFinite(T)) return 15; // default
    // Round to integer minutes per bin; tolerate non-divisible day
    return Math.max(1, Math.round(1440 / T));
  }, [evalState.data?.num_time_bins]);

  useEffect(() => {
    if (autostart && input && !evalState.data && !evalState.loading) {
      void handleRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, input]);

  const handleRun = async () => {
    if (!input) return;
    setEvalState({ loading: true, error: null, data: null });
    try {
      const body: any = { ...input };
      if (!body.weights && weightsOverride && Object.keys(weightsOverride).length > 0) {
        body.weights = weightsOverride;
      }
      // Don't forward UI-only metadata if present
      delete body.colorsByFlow;
      const res = await fetch("/api/base_evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      const json = (await res.json()) as BaseEvaluationResponse;
      setEvalState({ loading: false, error: null, data: json });
    } catch (e: any) {
      setEvalState({ loading: false, error: e?.message || "Failed to run base evaluation", data: null });
    }
  };

  // Build highlight sets for quick lookup: `${tv}|${bin}` -> true
  const targetHighlights = useMemo(() => {
    const arr = evalState.data?.target_cells || [];
    const s = new Set<string>();
    for (const [tv, bin] of arr) s.add(`${tv}|${bin}`);
    return s;
  }, [evalState.data?.target_cells]);
  const rippleHighlights = useMemo(() => {
    const arr = evalState.data?.ripple_cells || [];
    const s = new Set<string>();
    for (const [tv, bin] of arr) s.add(`${tv}|${bin}`);
    return s;
  }, [evalState.data?.ripple_cells]);

  const flowFlightCounts = useMemo(() => {
    const mp = new Map<number, number>();
    const mapping = input?.flows || {};
    for (const [k, v] of Object.entries(mapping)) {
      const id = Number(k);
      const n = Array.isArray(v) ? v.length : 0;
      mp.set(id, n);
    }
    return mp;
  }, [input?.flows]);

  const encodedShareUrl = useMemo(() => {
    const current: any = { ...input };
    if (weightsOverride && Object.keys(weightsOverride).length > 0) current.weights = weightsOverride;
    const b64 = encodePayloadParam(current);
    const view = `${viewFrom}-${viewTo}`;
    const params = new URLSearchParams();
    if (b64) params.set("payload", b64);
    if (view) params.set("view", view);
    params.set("autostart", "1");
    return `/flow-evaluation?${params.toString()}`;
  }, [input, weightsOverride, viewFrom, viewTo]);

  return (
    <main className="min-h-screen w-screen overflow-x-hidden bg-slate-900 relative">
      <Header />
      <div className="pt-16 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <div className="text-[11px] uppercase tracking-wider text-white/70">Analytics</div>
            <h1 className="text-2xl font-semibold text-white">Flow Impact Evaluation</h1>
          </div>

          {/* Top controls + summary */}
          <section className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <button
                onClick={handleRun}
                disabled={!input || evalState.loading}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-colors ${evalState.loading ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white opacity-80 cursor-wait' : input ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/20 hover:from-blue-500 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/40' : 'opacity-50 cursor-not-allowed border border-white/20 bg-white/5 text-white/60'}`}
              >
                {evalState.loading ? <ShimmeringText text="Evaluating..." /> : 'Run Evaluation'}
              </button>
              
              {evalState.error && <div className="text-[11px] text-red-200">{evalState.error}</div>}
            </div>

            {/* Inputs summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Flows */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Flows</div>
                {input ? (
                  <FlowsSummary flows={input.flows || {}} colors={input.colorsByFlow || {}} />
                ) : (
                  <div className="text-xs text-white/70">No input payload provided.</div>
                )}
              </div>

              {/* Targets */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Target TVs</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(input?.targets || {}).map(([tv, tw]) => (
                    <div key={tv} className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-xs text-white/90 flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#f59e0b' }} />
                      <span className="font-mono">{tv}</span>
                      <span className="opacity-70 ml-1">{tw.from}–{tw.to}</span>
                    </div>
                  ))}
                  {(!input || Object.keys(input.targets || {}).length === 0) && (
                    <div className="text-xs text-white/70">None</div>
                  )}
                </div>
              </div>

              {/* Ripples */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Ripple TVs</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(input?.ripples || {}).map(([tv, tw]) => (
                    <div key={tv} className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-xs text-white/90 flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#c084fc' }} />
                      <span className="font-mono">{tv}</span>
                      <span className="opacity-70 ml-1">{tw.from}–{tw.to}</span>
                    </div>
                  ))}
                  {(!input || !input.ripples || Object.keys(input.ripples).length === 0) && (
                    <div className="text-xs text-white/70">None</div>
                  )}
                </div>
              </div>
            </div>

            {/* Weights override */}
            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">Weights</div>
              <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-white/90">
                  <thead className="bg-white/5 text-white/70">
                    <tr>
                      <th className="text-left px-3 py-2">Weight key</th>
                      <th className="text-left px-3 py-2">Value</th>
                      <th className="text-left px-3 py-2 w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(weightsOverride || {}).map(([key, val]) => (
                      <tr key={key} className="border-t border-white/10">
                        <td className="px-3 py-2 font-mono text-[12px] text-white/80">{key}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={String(val)}
                            onChange={(e) => {
                              const num = Number(e.currentTarget.value);
                              setWeightsOverride((prev) => ({ ...(prev || {}), [key]: Number.isFinite(num) ? num : 0 }));
                            }}
                            className="w-32 px-2 py-1 bg-white/10 border border-white/20 rounded-md text-white"
                            style={{ colorScheme: 'dark' }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => setWeightsOverride((prev) => {
                              const next = { ...(prev || {}) } as Record<string, number>;
                              delete next[key];
                              return next;
                            })}
                            className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-[12px] text-white/80 hover:bg-white/15"
                          >Remove</button>
                        </td>
                      </tr>
                    ))}
                    <WeightsAddRow onAdd={(key, val) => setWeightsOverride((prev) => ({ ...(prev || {}), [key]: val }))} />
                  </tbody>
                </table>
              </div>
            </div>

            {/* Debug toggles */}
            <div className="mt-3 flex items-center gap-3 text-[12px]">
              <label className="inline-flex items-center gap-2 text-white/90">
                <input type="checkbox" className="accent-blue-500" checked={showLabels} onChange={(e) => setShowLabels(e.currentTarget.checked)} />
                Show labels on charts
              </label>
              <button
                onClick={() => setShowDebug((s) => !s)}
                className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15"
              >{showDebug ? 'Hide Request' : 'Show Request'}</button>
              <button
                onClick={() => setShowResponse((s) => !s)}
                className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15"
              >{showResponse ? 'Hide Response' : 'Show Response'}</button>
            </div>
            {showDebug && (
              <div className="mt-2 bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white/90 font-mono max-h-48 overflow-auto">
                {JSON.stringify(input, null, 2)}
              </div>
            )}
            {showResponse && evalState.data && (
              <div className="mt-2 bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white/90 font-mono max-h-72 overflow-auto">
                {JSON.stringify(evalState.data, null, 2)}
              </div>
            )}
          </section>

          {/* Histogram view control */}
          <section className="mb-6">
            <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Histogram View Range</div>
            <TimeScaleControl
              time_from={viewFrom}
              time_to={viewTo}
              stepMinutes={minutesPerBin}
              onCommit={(f, t) => { setViewFrom(f); setViewTo(t); }}
            />
          </section>

          {/* Per-flow results */}
          <section>
            {evalState.loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {new Array(6).fill(0).map((_, i) => (
                  <div key={i} className="h-40 bg-white/5 border border-white/10 rounded-xl animate-pulse" />
                ))}
              </div>
            )}

            {evalState.data?.flows?.map((flow, idx) => {
              const numFlights = flowFlightCounts.get(flow.flow_id) || 0;
              const controlledTv = flow.controlled_volume || null;
              const targets = flow.target_demands || {};
              const ripples = flow.ripple_demands || {};

              // Ensure controlled TV first in targets grid
              const targetTvIds = Object.keys(targets).sort((a, b) => {
                if (controlledTv && a === controlledTv) return -1;
                if (controlledTv && b === controlledTv) return 1;
                return a.localeCompare(b);
              });
              const rippleTvIds = Object.keys(ripples).sort((a, b) => a.localeCompare(b));

              return (
                <div key={`flow-${idx}`} className="mb-8">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="text-lg font-semibold text-white">Flow {flow.flow_id} • {numFlights} flights</div>
                    {controlledTv && (
                      <span className="text-[11px] px-2 py-1 rounded-md border border-rose-400/70 bg-rose-500/10 text-rose-200">Controlled volume: {controlledTv}</span>
                    )}
                  </div>

                  {/* Target TV charts */}
                  <div className="mb-4">
                    <div className="text-sm uppercase tracking-wider text-gray-300 mb-2">Targets</div>
                    {targetTvIds.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
                        {targetTvIds.map((tvId) => (
                          <HistogramCard
                            key={`t-${flow.flow_id}-${tvId}`}
                            tvId={tvId}
                            series={targets[tvId] || []}
                            minutesPerBin={minutesPerBin}
                            viewFrom={viewFrom}
                            viewTo={viewTo}
                            isControlled={controlledTv === tvId}
                            showLabels={showLabels}
                            attentionSet={targetHighlights}
                            markerColor="#f59e0b"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-300">No target demands.</div>
                    )}
                  </div>

                  {/* Ripple TV charts */}
                  {rippleTvIds.length > 0 && (
                    <div>
                      <div className="text-sm uppercase tracking-wider text-gray-300 mb-2">Ripples</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
                        {rippleTvIds.map((tvId) => (
                          <HistogramCard
                            key={`r-${flow.flow_id}-${tvId}`}
                            tvId={tvId}
                            series={ripples[tvId] || []}
                            minutesPerBin={minutesPerBin}
                            viewFrom={viewFrom}
                            viewTo={viewTo}
                            isControlled={false}
                            showLabels={showLabels}
                            attentionSet={rippleHighlights}
                            markerColor="#c084fc"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* Objective & components */}
          {evalState.data?.objective && (
            <section className="mt-8">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Objective</div>
                  <div className="text-3xl font-semibold text-white">{Number(evalState.data.objective?.score ?? 0).toFixed(1)}</div>
                </div>
                {Object.entries(evalState.data.objective?.components || {}).map(([k, v]) => (
                  <div key={k} className="bg-white/5 border border-white/10 rounded-lg p-4">
                    <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">{k}</div>
                    <div className="text-3xl font-semibold text-white">{Number(v).toFixed(1)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function WeightsAddRow({ onAdd }: { onAdd: (key: string, val: number) => void }) {
  const [keyInput, setKeyInput] = useState("");
  const [valInput, setValInput] = useState<string>("");
  const handleAdd = () => {
    const key = keyInput.trim();
    const num = Number(valInput);
    if (!key || !Number.isFinite(num)) return;
    onAdd(key, num);
    setKeyInput("");
    setValInput("");
  };
  return (
    <tr className="border-t border-white/10">
      <td className="px-3 py-2">
        <input
          placeholder="weight key (e.g., alpha_gt)"
          value={keyInput}
          onChange={(e) => setKeyInput(e.currentTarget.value)}
          className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded-md text-white text-[12px]"
        />
      </td>
      <td className="px-3 py-2">
        <input
          placeholder="value"
          type="number"
          value={valInput}
          onChange={(e) => setValInput(e.currentTarget.value)}
          className="w-32 px-2 py-1 bg-white/10 border border-white/20 rounded-md text-white"
          style={{ colorScheme: 'dark' }}
        />
      </td>
      <td className="px-3 py-2">
        <button onClick={handleAdd} className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-[12px] text-white/80 hover:bg-white/15">Add</button>
      </td>
    </tr>
  );
}

// Downloads removed per updated design.

function FlowsSummary({ flows, colors }: { flows: Record<string, string[]>; colors: Record<string, string> }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setExpanded((prev) => ({ ...prev, [k]: !prev[k] }));
  const entries = Object.entries(flows || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  return (
    <div className="space-y-2">
      {entries.map(([fid, flights]) => {
        const showAll = !!expanded[fid];
        const list = flights || [];
        const shown = showAll ? list : list.slice(0, 8);
        return (
          <div key={fid} className="text-sm text-white/90">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: colors?.[String(fid)] || '#60a5fa' }} />
                <span>Flow {fid}</span>
              </div>
              <span className="text-white/70">{list.length} flights</span>
            </div>
            {list.length > 0 && (
              <div className="mt-1">
                <div className="flex flex-wrap gap-1">
                  {shown.map((id, i) => (
                    <span key={`${fid}-${i}`} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[11px] font-mono text-white/80">{id}</span>
                  ))}
                  {list.length > shown.length && (
                    <button onClick={() => toggle(fid)} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[11px] text-white/80 hover:bg-white/15">Show all</button>
                  )}
                  {showAll && list.length > 8 && (
                    <button onClick={() => toggle(fid)} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[11px] text-white/80 hover:bg-white/15">Show less</button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HistogramCard({ tvId, series, minutesPerBin, viewFrom, viewTo, isControlled, showLabels, attentionSet, markerColor }: {
  tvId: string;
  series: number[];
  minutesPerBin: number;
  viewFrom: string;
  viewTo: string;
  isControlled: boolean;
  showLabels: boolean;
  attentionSet: Set<string>;
  markerColor?: string;
}) {
  const rows = useMemo(() => {
    const n = series.length;
    const arr = new Array(n).fill(0).map((_, i) => {
      const startMin = i * minutesPerBin;
      const value = Number(series[i] ?? 0);
      const isAttention = attentionSet.has(`${tvId}|${i}`);
      return { idx: i, value, startMin, isAttention };
    });
    const vFrom = hhmmToMinutesSafe(viewFrom);
    const vTo = hhmmToMinutesSafe(viewTo);
    return arr.filter((r) => r.startMin >= vFrom && r.startMin <= vTo);
  }, [series, minutesPerBin, attentionSet, tvId, viewFrom, viewTo]);

  const total = useMemo(() => series.reduce((s, v) => s + (Number(v) || 0), 0), [series]);
  const peak = useMemo(() => {
    let bestIdx = -1; let bestVal = -Infinity;
    for (let i = 0; i < series.length; i++) { const v = Number(series[i] || 0); if (v > bestVal) { bestVal = v; bestIdx = i; } }
    return { idx: bestIdx, value: bestVal };
  }, [series]);
  const attentionSum = useMemo(() => rows.reduce((s, r) => s + (r.isAttention ? r.value : 0), 0), [rows]);

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
              tickFormatter={(value: any) => {
                const i = Number(value ?? 0);
                return binIndexToRangeLabel(i, minutesPerBin);
              }}
            />
            <YAxis tick={{ fontSize: 10 }} axisLine={true} tickLine={true} width={32} />
            <Tooltip
              wrapperStyle={{ zIndex: 20 }}
              contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
              itemStyle={{ color: 'white' }}
              labelStyle={{ color: 'white' }}
              labelFormatter={(labelIdx: any) => {
                const i = Number(labelIdx ?? 0);
                return binIndexToRangeLabel(i, minutesPerBin);
              }}
              formatter={(value: any) => [String(value), 'Count']}
            />
            <Bar dataKey="value">
              {rows.map((r, i) => (
                <Cell key={`c-${i}`} fill={r.isAttention ? '#fb7185' /* rose-400 */ : '#60a5fa'} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-white/80">
        <div>Total: <span className="font-mono text-white/90">{total}</span></div>
        <div>Peak: <span className="font-mono text-white/90">{Number.isFinite(peak.value) ? peak.value : 0}</span> @{peak.idx >= 0 ? binIndexToRangeLabel(peak.idx, minutesPerBin) : '--'}</div>
        <div>Attention sum: <span className="font-mono text-white/90">{attentionSum}</span></div>
      </div>
    </div>
  );
}
