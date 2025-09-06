"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import TimeScaleControl from "@/components/TimeScaleControl";
import ShimmeringText from "@/components/ShimmeringText";
import { BaseEvaluationResponse, AutomaticRateAdjustmentResponse } from "@/lib/models";
import { useSimStore } from "@/components/useSimStore";
import { loadTrajectories } from "@/lib/flights";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
} from "recharts";

type FlowInputPayload = {
  flows: Record<string | number, string[]>;
  targets: Record<string, { from: string; to: string }>;
  ripples?: Record<string, { from: string; to: string }>;
  auto_ripple_time_bins?: number;
  indexer_path?: string;
  flights_path?: string;
  capacities_path?: string;
  weights?: Record<string, number>;
  // optional metadata for UI only
  colorsByFlow?: Record<string, string>;
};

type FetchState = { loading: boolean; error: string | null; data: BaseEvaluationResponse | null };
type OptFetchState = { loading: boolean; error: string | null; data: AutomaticRateAdjustmentResponse | null };

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
  const { flights, setFlights, setRange } = useSimStore();

  const [input, setInput] = useState<FlowInputPayload | null>(() => decodePayloadParam(payloadParam));
  const [evalState, setEvalState] = useState<FetchState>({ loading: false, error: null, data: null });
  const [optState, setOptState] = useState<OptFetchState>({ loading: false, error: null, data: null });
  const [viewFrom, setViewFrom] = useState<string>(viewParam?.from || "00:00");
  const [viewTo, setViewTo] = useState<string>(viewParam?.to || "23:59");
  const [showDebug, setShowDebug] = useState<boolean>(false);
  const [showResponse, setShowResponse] = useState<boolean>(false);
  const [showOptResponse, setShowOptResponse] = useState<boolean>(false);
  const [weightsOverride, setWeightsOverride] = useState<Record<string, number> | null>(null);
  const [showLabels, setShowLabels] = useState<boolean>(false);
  const [showWeightDetails, setShowWeightDetails] = useState<boolean>(false);
  const [saParamsOverride, setSaParamsOverride] = useState<Record<string, number> | null>(null);
  const [rippleSummaryExpanded, setRippleSummaryExpanded] = useState<boolean>(false);
  const [expandedTargetCharts, setExpandedTargetCharts] = useState<Record<number, boolean>>({});
  const [expandedRippleCharts, setExpandedRippleCharts] = useState<Record<number, boolean>>({});
  const [expandedOccAll, setExpandedOccAll] = useState<boolean>(false);
  // View toggle UI only (logic wiring to be handled later)
  const [seriesView, setSeriesView] = useState<'demand' | 'occupancy' | 'occupancy_all'>("demand");

  type AutorateOccupancyResponse = {
    time_bin_minutes: number;
    num_bins: number;
    tv_ids_order: string[];
    timebins?: { labels?: string[] };
    pre_counts: Record<string, number[]>;
    post_counts: Record<string, number[]>;
    capacity?: Record<string, number[]>;
  };
  const [occAllState, setOccAllState] = useState<{ loading: boolean; error: string | null; data: AutorateOccupancyResponse | null }>({ loading: false, error: null, data: null });

  const minutesPerBin = useMemo(() => {
    // Prefer explicit minutes from Occupancy All response if present
    if (occAllState.data?.time_bin_minutes && Number.isFinite(occAllState.data.time_bin_minutes)) {
      return Math.max(1, Math.round(occAllState.data.time_bin_minutes));
    }
    const T = evalState.data?.num_time_bins || optState.data?.num_time_bins;
    if (!T || !Number.isFinite(T)) return 15; // default
    // Round to integer minutes per bin; tolerate non-divisible day
    return Math.max(1, Math.round(1440 / (T as number)));
  }, [occAllState.data?.time_bin_minutes, evalState.data?.num_time_bins, optState.data?.num_time_bins]);

  async function handleSelectOccupancyAll() {
    if (!input) {
      setOccAllState({ loading: false, error: 'No input payload provided.', data: null });
      return;
    }
    try {
      setOccAllState({ loading: true, error: null, data: null });
      // Ensure we have an autorate result; if not, run optimization first using current overrides
      let autorateResult = optState.data;
      if (!autorateResult) {
        const body: any = { ...input };
        if (!body.weights && weightsOverride && Object.keys(weightsOverride).length > 0) {
          body.weights = weightsOverride;
        }
        if (saParamsOverride && Object.keys(saParamsOverride).length > 0) {
          body.sa_params = saParamsOverride;
        }
        delete body.colorsByFlow;
        const optRes = await fetch("/api/automatic_rate_adjustment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!optRes.ok) {
          const text = await optRes.text();
          throw new Error(text || `Optimization failed: ${optRes.status}`);
        }
        const optJson = (await optRes.json()) as AutomaticRateAdjustmentResponse;
        setOptState({ loading: false, error: null, data: optJson });
        autorateResult = optJson;
      }

      // Now request aggregated occupancy
      const occRes = await fetch("/api/autorate_occupancy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autorate_result: autorateResult, include_capacity: true }),
      });
      if (!occRes.ok) {
        const text = await occRes.text();
        throw new Error(text || `autorate_occupancy failed: ${occRes.status}`);
      }
      const occJson = (await occRes.json()) as AutorateOccupancyResponse;
      setOccAllState({ loading: false, error: null, data: occJson });
    } catch (e: any) {
      setOccAllState({ loading: false, error: e?.message || 'Failed to fetch Occupancy All aggregation', data: null });
    }
  }

  useEffect(() => {
    if (autostart && input && !evalState.data && !evalState.loading) {
      void handleRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, input]);

  // Ensure flight metadata is available for tables (callsign, origin, destination, takeoff)
  useEffect(() => {
    let cancelled = false;
    if (flights.length > 0) return;
    (async () => {
      try {
        const tracks = await loadTrajectories("/data/flights_20230801.csv");
        if (cancelled) return;
        setFlights(tracks);
        if (tracks && tracks.length > 0) {
          const minT = Math.min(...tracks.map((tr: any) => tr.t0));
          const maxT = Math.max(...tracks.map((tr: any) => tr.t1));
          setRange([minT, maxT], minT);
        }
      } catch (e) {
        console.warn("Failed to load flight trajectories for Flow Evaluation page", e);
      }
    })();
    return () => { cancelled = true; };
  }, [flights.length, setFlights, setRange]);

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

  const handleOptimize = async () => {
    if (!input) return;
    setOptState({ loading: true, error: null, data: null });
    try {
      const body: any = { ...input };
      if (!body.weights && weightsOverride && Object.keys(weightsOverride).length > 0) {
        body.weights = weightsOverride;
      }
      if (saParamsOverride && Object.keys(saParamsOverride).length > 0) {
        body.sa_params = saParamsOverride;
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

  // TVs derived from response ripple cells (preferred display when available)
  const rippleTvIdsFromResponse = useMemo(() => {
    const cells = evalState.data?.ripple_cells || [];
    const ids = Array.from(new Set(cells.map((c) => String(c[0]))));
    return ids.sort((a, b) => a.localeCompare(b));
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

  // Descriptions for known weight terms
  const WEIGHT_DEFINITIONS: Array<{ key: string; description: string }> = useMemo(() => ([
    // Capacity exceedance (alpha)
    { key: 'alpha_gt', description: 'Penalty on rolling-hour capacity exceedance in target cells (J_cap).' },
    { key: 'alpha_rip', description: 'Penalty on rolling-hour exceedance in ripple cells (J_cap).' },
    { key: 'alpha_ctx', description: 'Penalty on rolling-hour exceedance in context cells (J_cap).' },
    // Demand deviation regularization (beta)
    { key: 'beta_gt', description: 'Weight on |n_f(t) − d_f(t)| for target bins (J_reg).' },
    { key: 'beta_rip', description: 'Weight on |n_f(t) − d_f(t)| for ripple bins (J_reg).' },
    { key: 'beta_ctx', description: 'Weight on |n_f(t) − d_f(t)| for context/overflow bins (J_reg).' },
    // Temporal smoothness (gamma)
    { key: 'gamma_gt', description: 'Weight on temporal variation |n_f(t+1) − n_f(t)| for target bins (J_tv).' },
    { key: 'gamma_rip', description: 'Weight on temporal variation for ripple bins (J_tv).' },
    { key: 'gamma_ctx', description: 'Weight on temporal variation for context/overflow bins (J_tv).' },
    // Delay cost
    { key: 'lambda_delay', description: 'Multiplier on total pushback delay minutes (J_delay).' },
    // Fairness and spill (optional)
    { key: 'theta_share', description: 'Weight on per-bin deviation of flow shares from demand shares (J_share).' },
    { key: 'eta_spill', description: 'Penalty per unit released into overflow bin T (J_spill).' },
    // Classification tolerance
    { key: 'class_tolerance_w', description: 'Bin tolerance w for GT/RIP classification (affects β/γ class only).' },
  ]), []);

  const SA_PARAM_DEFINITIONS: Array<{ key: string; description: string; default: number }> = useMemo(() => ([
    { key: 'iterations', description: 'Total SA moves to attempt', default: 1000 },
    { key: 'warmup_moves', description: 'Initial moves before cooling begins', default: 50 },
    { key: 'alpha_T', description: 'Temperature decay factor per period', default: 0.95 },
    { key: 'L', description: 'Temperature update period', default: 50 },
    { key: 'seed', description: 'Random seed (0 for deterministic default)', default: 0 },
    { key: 'attention_bias', description: 'Probability to sample from target/ripple bins', default: 0.8 },
    { key: 'max_shift', description: 'Maximum Δ for shift-later', default: 4 },
    { key: 'pull_max', description: 'Maximum Δ for pull-forward', default: 2 },
    { key: 'smooth_window_max', description: 'Max window length for smoothing', default: 3 },
    { key: 'rate_change_lower_bound_min', description: 'Minutes to expand below earliest target bin', default: 0 },
    { key: 'rate_change_upper_bound_min', description: 'Minutes to expand above latest target bin', default: 0 },
  ]), []);

  return (
    <main className="min-h-screen w-screen overflow-x-hidden bg-slate-900 relative">
      <Header />
      <div className="pt-16 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <div className="text-[11px] uppercase tracking-wider text-white/70">Analytics</div>
            <h1 className="text-2xl font-semibold text-white">Flow Impact Evaluation and Optimization</h1>
          </div>

          {/* Top controls + summary */}
          <section className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <button
                onClick={handleRun}
                disabled={!input || evalState.loading}
                className={`px-3 py-1 rounded-lg border text-xs ${evalState.loading ? 'border-blue-400/50 bg-blue-500/20 text-blue-200' : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
              >
                {evalState.loading ? <ShimmeringText text="Evaluating..." /> : 'Run Evaluation'}
              </button>
              
              <button
                onClick={handleOptimize}
                disabled={!input || evalState.loading || optState.loading}
                className={`px-3 py-1 rounded-lg border text-xs ${optState.loading ? 'border-purple-400/50 bg-purple-500/20 text-purple-200' : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
              >
                {optState.loading ? <ShimmeringText text="Playing in Boltzmann Realms..." /> : "Optimize Release Rates with Simulated Annealing"}
              </button>
              {optState.error && <div className="text-[11px] text-red-200">{optState.error}</div>}
              
              {evalState.error && <div className="text-[11px] text-red-200">{evalState.error}</div>}
            </div>

            {/* Inputs summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Flows */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-3 max-h-72 overflow-y-auto">
                <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Flows</div>
                {input ? (
                  <FlowsSummary
                    flows={input.flows || {}}
                    colors={input.colorsByFlow || {}}
                    optDelays={optState.data?.delays_min || null}
                  />
                ) : (
                  <div className="text-xs text-white/70">No input payload provided.</div>
                )}
              </div>

              {/* Targets */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-3 max-h-72 overflow-y-auto">
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
              <div className="bg-white/5 border border-white/10 rounded-lg p-3 max-h-72 overflow-y-auto">
                <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Ripple TVs</div>
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const LIMIT = 25;
                    if (rippleTvIdsFromResponse.length > 0) {
                      const list = rippleTvIdsFromResponse;
                      const shown = rippleSummaryExpanded ? list : list.slice(0, LIMIT);
                      return (
                        <>
                          {shown.map((tv) => (
                            <div key={tv} className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-xs text-white/90 flex items-center gap-1.5">
                              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#c084fc' }} />
                              <span className="font-mono">{tv}</span>
                            </div>
                          ))}
                          {list.length > LIMIT && (
                            <button
                              onClick={() => setRippleSummaryExpanded((s) => !s)}
                              className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[11px] text-white/80 hover:bg-white/15"
                            >{rippleSummaryExpanded ? 'Show less' : 'Show more'}</button>
                          )}
                        </>
                      );
                    }
                    const entries = Object.entries(input?.ripples || {}).sort((a, b) => a[0].localeCompare(b[0]));
                    if (entries.length === 0) return <div className="text-xs text-white/70">None</div>;
                    const shown = rippleSummaryExpanded ? entries : entries.slice(0, LIMIT);
                    return (
                      <>
                        {shown.map(([tv, tw]) => (
                          <div key={tv} className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-xs text-white/90 flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#c084fc' }} />
                            <span className="font-mono">{tv}</span>
                            <span className="opacity-70 ml-1">{tw.from}–{tw.to}</span>
                          </div>
                        ))}
                        {entries.length > LIMIT && (
                          <button
                            onClick={() => setRippleSummaryExpanded((s) => !s)}
                            className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[11px] text-white/80 hover:bg-white/15"
                          >{rippleSummaryExpanded ? 'Show less' : 'Show more'}</button>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Demand vs Occupancy */}

            {/* Weights override */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-white/60">Weights and Hyperparameters</div>
                <button
                  onClick={() => setShowWeightDetails((s) => !s)}
                  className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 text-[12px]"
                >{showWeightDetails ? 'Hide Details' : 'Show Details'}</button>
              </div>
              {showWeightDetails && (
              <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-white/90">
                  <thead className="bg-white/5 text-white/70">
                    <tr>
                      <th className="text-left px-3 py-2">Weight key</th>
                      <th className="text-left px-3 py-2">Description</th>
                      <th className="text-left px-3 py-2">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const used = (evalState.data?.weights_used || {}) as Record<string, number>;
                      const override = (weightsOverride || {}) as Record<string, number>;
                      const knownKeys = WEIGHT_DEFINITIONS.map((d) => d.key);
                      const extraKeys = Array.from(new Set([
                        ...Object.keys(used || {}),
                        ...Object.keys(override || {}),
                      ])).filter((k) => !knownKeys.includes(k));
                      const orderedKeys = [...knownKeys, ...extraKeys];
                      return orderedKeys.map((key) => {
                        const def = WEIGHT_DEFINITIONS.find((d) => d.key === key);
                        const hasOverride = override && Object.prototype.hasOwnProperty.call(override, key);
                        const displayVal = hasOverride
                          ? String(override[key])
                          : (used && Object.prototype.hasOwnProperty.call(used, key))
                            ? String(used[key])
                            : '';
                        return (
                          <tr key={key} className="border-t border-white/10 align-top">
                            <td className="px-3 py-2 font-mono text-[12px] text-white/80 whitespace-nowrap">{key}</td>
                            <td className="px-3 py-2 text-white/70 text-[12px]">
                              {def?.description || 'Custom weight key'}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={displayVal}
                                onChange={(e) => {
                                  const raw = e.currentTarget.value;
                                  setWeightsOverride((prev) => {
                                    const base = { ...(prev || {}) } as Record<string, number>;
                                    if (raw === '') {
                                      // Clear override to fall back to used value
                                      delete base[key];
                                      return Object.keys(base).length > 0 ? base : null;
                                    }
                                    const num = Number(raw);
                                    if (!Number.isFinite(num)) return base;
                                    base[key] = num;
                                    return base;
                                  });
                                }}
                                className="w-32 px-2 py-1 bg-white/10 border border-white/20 rounded-md text-white"
                                style={{ colorScheme: 'dark' }}
                              />
                            </td>
                            
                          </tr>
                        );
                      });
                    })()}
                    <WeightsAddRow onAdd={(key, val) => setWeightsOverride((prev) => ({ ...(prev || {}), [key]: val }))} />
                  </tbody>
                </table>
              </div>
              )}

              {showWeightDetails && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Optimization Hyperparameters</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                  <table className="w-full text-sm text-white/90">
                    <thead className="bg-white/5 text-white/70">
                      <tr>
                        <th className="text-left px-3 py-2">Parameter</th>
                        <th className="text-left px-3 py-2">Description</th>
                        <th className="text-left px-3 py-2">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SA_PARAM_DEFINITIONS.map(({ key, description, default: defVal }) => {
                        const used = (optState.data?.sa_params_used || {}) as Record<string, number>;
                        const override = (saParamsOverride || {}) as Record<string, number>;
                        const hasOverride = override && Object.prototype.hasOwnProperty.call(override, key);
                        const displayVal = hasOverride
                          ? String(override[key])
                          : (used && Object.prototype.hasOwnProperty.call(used, key))
                            ? String(used[key])
                            : String(defVal);
                        return (
                          <tr key={key} className="border-t border-white/10 align-top">
                            <td className="px-3 py-2 font-mono text-[12px] text-white/80 whitespace-nowrap">{key}</td>
                            <td className="px-3 py-2 text-white/70 text-[12px]">{description}</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={displayVal}
                                onChange={(e) => {
                                  const raw = e.currentTarget.value;
                                  setSaParamsOverride((prev) => {
                                    const base = { ...(prev || {}) } as Record<string, number>;
                                    if (raw === '') {
                                      delete base[key];
                                      return Object.keys(base).length > 0 ? base : null;
                                    }
                                    const num = Number(raw);
                                    if (!Number.isFinite(num)) return base;
                                    base[key] = num;
                                    return base;
                                  });
                                }}
                                className="w-32 px-2 py-1 bg-white/10 border border-white/20 rounded-md text-white"
                                style={{ colorScheme: 'dark' }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
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
              >{showResponse ? 'Hide Baseline Response' : 'Show Baseline Response'}</button>
              <button
                onClick={() => setShowOptResponse((s) => !s)}
                className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15"
              >{showOptResponse ? 'Hide Optimization Response' : 'Show Optimization Response'}</button>
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
            {showOptResponse && optState.data && (
              <div className="mt-2 bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white/90 font-mono max-h-72 overflow-auto">
                {JSON.stringify(optState.data, null, 2)}
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

          {/* Objective & components */}
          {!!evalState.data?.objective && !optState.data && (
            <section className="mb-8">
              {(() => {
                const score = Number(evalState.data?.objective?.score ?? 0);
                const rawEntries = Object.entries(evalState.data?.objective?.components || {});
                const entries = rawEntries
                  .map(([name, raw]) => ({ name, value: Number(raw) }))
                  .filter((d) => Number.isFinite(d.value));
                const positives = entries.filter((d) => d.value > 0);
                const sum = positives.reduce((s, d) => s + d.value, 0);
                const colors = ['#60a5fa','#f59e0b','#34d399','#a78bfa','#f472b6','#f87171','#22d3ee','#eab308','#4ade80','#f97316','#c084fc'];
                return (
                  <div className="grid gap-4 md:grid-rows-2 md:grid-flow-col auto-cols-fr">
                    {/* Objective card */}
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4 min-h-[96px]">
                      <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Objective</div>
                      <div className="text-3xl font-semibold text-white">{Number.isFinite(score) ? score.toFixed(1) : '0.0'}</div>
                      <div className="text-[12px] text-white/60 mt-1">Lower is better</div>
                    </div>
                    {/* Component value cards */}
                    {entries.length === 0 && (
                      <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-sm text-white/70 min-h-[96px]">No component breakdown available.</div>
                    )}
                    {entries.length > 0 && entries.map((d) => (
                      <div key={String(d.name)} className="bg-white/5 border border-white/10 rounded-lg p-4 min-h-[96px]">
                        <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">{String(d.name)}</div>
                        <div className="text-2xl md:text-3xl font-semibold text-white">{Number(d.value).toFixed(1)}</div>
                      </div>
                    ))}
                    {/* Pie chart as part of the same grid, spans two rows on md+ */}
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4 md:row-span-2 md:min-h-[260px]">
                      <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">Component Shares</div>
                      {sum <= 0 ? (
                        <div className="text-sm text-white/70">No positive components to display.</div>
                      ) : (
                        <div className="h-44 md:h-[180px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={positives.map((d, i) => ({ ...d, fill: colors[i % colors.length] }))}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={38}
                                outerRadius={68}
                                paddingAngle={2}
                                stroke="rgba(255,255,255,0.15)"
                              >
                                {positives.map((_, i) => (
                                  <Cell key={`slice-${i}`} fill={colors[i % colors.length]} />
                                ))}
                              </Pie>
                              <Tooltip
                                formatter={(val: any, name: any) => {
                                  const v = Number(val) || 0;
                                  const pct = sum > 0 ? (v * 100) / sum : 0;
                                  return [`${v.toFixed(2)} (${pct.toFixed(1)}%)`, String(name)];
                                }}
                                contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: 'white' }}
                                itemStyle={{ color: 'white' }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      {sum > 0 && (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-white/80">
                          {positives.map((d, i) => (
                            <div key={`legend-${d.name}`} className="flex items-center gap-2">
                              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: colors[i % colors.length] }} />
                              <span className="truncate" title={d.name}>{d.name}</span>
                              <span className="ml-auto font-mono opacity-80">{((d.value * 100) / sum).toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </section>
          )}


          {/* Demand vs Occupancy toggle (adds Occupancy All) */}
          <div className="mt-3 flex items-center gap-2 mb-6">
              <div className="text-[11px] uppercase tracking-wider text-white/60">Histogram Values</div>
              <div className="inline-flex rounded-md shadow-xs overflow-hidden" role="group" aria-label="Toggle view between Demand, Occupancy, and Occupancy All">
                <button
                  type="button"
                  aria-pressed={seriesView === 'demand'}
                  onClick={() => setSeriesView('demand')}
                  className={`px-3 py-1.5 text-[12px] font-medium border transition-colors ${
                    seriesView === 'demand'
                      ? 'bg-blue-500/20 border-blue-400/60 text-white'
                      : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'
                  } rounded-l-md`}
                >
                  Rate (Demand)
                </button>
                <button
                  type="button"
                  aria-pressed={seriesView === 'occupancy'}
                  onClick={() => setSeriesView('occupancy')}
                  className={`px-3 py-1.5 text-[12px] font-medium border transition-colors -ml-px ${
                    seriesView === 'occupancy'
                      ? 'bg-blue-500/20 border-blue-400/60 text-white'
                      : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'
                  }`}
                >
                  Occupancy
                </button>
                <button
                  type="button"
                  aria-pressed={seriesView === 'occupancy_all'}
                  onClick={async () => { setSeriesView('occupancy_all'); await handleSelectOccupancyAll(); }}
                  className={`px-3 py-1.5 text-[12px] font-medium border transition-colors -ml-px ${
                    seriesView === 'occupancy_all'
                      ? 'bg-blue-500/20 border-blue-400/60 text-white'
                      : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'
                  } rounded-r-md`}
                >
                  Occupancy All
                </button>
              </div>
            </div>

          {seriesView === 'occupancy_all' && (
            <section className="mb-8">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-white/60">Aggregated Occupancy Across Flows</div>
                {occAllState.loading && <div className="text-xs text-white/70">Loading...</div>}
              </div>
              {occAllState.error && (
                <div className="text-xs text-rose-300 mb-2">{occAllState.error}</div>
              )}
              {occAllState.data && (() => {
                const d = occAllState.data!;
                const minutes = Number(d.time_bin_minutes || 15);
                const vFrom = hhmmToMinutesSafe(viewFrom);
                const vTo = hhmmToMinutesSafe(viewTo);
                const buildRows = (pre: number[], post: number[], capacitySeries?: number[]) => {
                  const n = Math.min(pre.length, post.length);
                  const rows: Array<{ idx: number; base: number; inc: number; dec: number; pre: number; post: number; capacity?: number | null }>
                    = new Array(n).fill(0).map((_, i) => {
                      const p0 = Number(pre[i] ?? 0);
                      const p1 = Number(post[i] ?? 0);
                      const base = Math.min(p0, p1);
                      const inc = Math.max(0, p1 - p0);
                      const dec = Math.max(0, p0 - p1);
                      const rawCap = capacitySeries?.[i];
                      const capNum = Number(rawCap);
                      const capacity = Number.isFinite(capNum) && capNum >= 0 ? capNum : null;
                      return { idx: i, base, inc, dec, pre: p0, post: p1, capacity };
                    });
                  return rows.filter(r => {
                    const startMin = r.idx * minutes;
                    return startMin >= vFrom && startMin <= vTo;
                  });
                };
                const tvs = (d.tv_ids_order || []).filter(tv => (d.pre_counts?.[tv] || []).length > 0);
                if (tvs.length === 0) return <div className="text-xs text-gray-300">No aggregated occupancy available.</div>;
                const LIMIT = 12;
                const showAll = expandedOccAll;
                const list = showAll ? tvs : tvs.slice(0, LIMIT);
                return (
                  <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
                    {list.map(tvId => {
                      const pre = d.pre_counts?.[tvId] || [];
                      const post = d.post_counts?.[tvId] || [];
                      const cap = d.capacity?.[tvId] || [];
                      const data = buildRows(pre, post, cap);
                      return (
                        <div key={`occ-all-${tvId}`} className="bg-white/5 border border-white/10 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-semibold text-white">{tvId}</div>
                          </div>
                          <div className="h-36">
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={data} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                                <XAxis
                                  dataKey="idx"
                                  tick={false}
                                  axisLine={false}
                                  tickLine={false}
                                />
                                <YAxis tick={false} axisLine={false} tickLine={false} width={0} />
                                <Tooltip
                                  contentStyle={{ background: "rgba(15,23,42,0.9)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
                                  formatter={(value, name, ctx: any) => {
                                    if (name === 'inc') return [`+${value}`, 'Post-Pre'];
                                    if (name === 'dec') return [`-${value}`, 'Pre-Post'];
                                    if (name === 'base') return [String(value), 'Base'];
                                    if (name === 'capacity') return [String(value), 'Capacity'];
                                    return [String(value), String(name)];
                                  }}
                                  labelFormatter={(label, payload: any) => {
                                    const p = Array.isArray(payload) && payload.length > 0 ? payload[0].payload : null;
                                    const preV = p?.pre ?? 0;
                                    const postV = p?.post ?? 0;
                                    const capV = p?.capacity;
                                    const labelText = binIndexToRangeLabel(Number(label ?? 0), minutes);
                                    return `${labelText}  |  pre: ${preV}  post: ${postV}${Number.isFinite(capV) ? `  cap: ${capV}` : ''}`;
                                  }}
                                />
                                <Bar dataKey="base" stackId="a" fill="#60a5fa" name="base" />
                                <Bar dataKey="inc" stackId="a" fill="#ef4444" name="inc" />
                                <Bar dataKey="dec" stackId="a" fill="#22c55e" name="dec" />
                                <Line type="stepAfter" dataKey="capacity" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {tvs.length > LIMIT && (
                    <div className="mt-2">
                      <button
                        onClick={() => setExpandedOccAll((s) => !s)}
                        className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 text-[12px]"
                      >{expandedOccAll ? 'Show less' : 'Show more'}</button>
                    </div>
                  )}
                  </>
                );
              })()}
            </section>
          )}

          {evalState.data?.objective && optState.data && (
            <section className="mb-8">
              {(() => {
                const b = optState.data!.objective_baseline;
                const o = optState.data!.objective_optimized;
                const compKeys = Array.from(new Set([
                  ...Object.keys(b.components || {}),
                  ...Object.keys(o.components || {}),
                ])).sort();
                const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "0.0");
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

          {/* Per-flow results (hidden when Occupancy All selected) */}
          {seriesView !== 'occupancy_all' && (
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
              // Choose baseline series based on view toggle, with safe fallbacks
              const targets = seriesView === 'demand'
                ? (flow.target_demands || {})
                : (flow.target_occupancy || flow.target_demands || {});
              const ripples = seriesView === 'demand'
                ? (flow.ripple_demands || {})
                : (flow.ripple_occupancy || flow.ripple_demands || {});
              const optFlow = optState.data?.flows?.find(f => f.flow_id === flow.flow_id);

              // Sort by total demand descending; ensure controlled TV first for targets
              const targetTvIds = Object.keys(targets).sort((a, b) => {
                if (controlledTv && a === controlledTv) return -1;
                if (controlledTv && b === controlledTv) return 1;
                const sumA = (targets[a] || []).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
                const sumB = (targets[b] || []).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
                if (sumA !== sumB) return sumB - sumA;
                return a.localeCompare(b);
              });
              const rippleTvIds = Object.keys(ripples).sort((a, b) => {
                const sumA = (ripples[a] || []).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
                const sumB = (ripples[b] || []).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
                if (sumA !== sumB) return sumB - sumA;
                return a.localeCompare(b);
              });

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
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
                          {(() => {
                            const LIMIT = 6;
                            const showAll = !!expandedTargetCharts[flow.flow_id];
                            const list = showAll ? targetTvIds : targetTvIds.slice(0, LIMIT);
                          return list.map((tvId) => {
                            const seriesOpt = seriesView === 'demand'
                              ? (optFlow?.target_demands?.[tvId] || null)
                              : (optFlow?.target_occupancy_opt?.[tvId] || null);
                            return (
                              <HistogramCard
                                key={`t-${flow.flow_id}-${tvId}`}
                                tvId={tvId}
                                series={targets[tvId] || []}
                                seriesB={seriesOpt}
                                minutesPerBin={minutesPerBin}
                                viewFrom={viewFrom}
                                viewTo={viewTo}
                                isControlled={controlledTv === tvId}
                                showLabels={showLabels}
                                attentionSet={targetHighlights}
                                markerColor="#f59e0b"
                              />
                            );
                          });
                          })()}
                        </div>
                        {targetTvIds.length > 6 && (
                          <div className="mt-2">
                            <button
                              onClick={() => setExpandedTargetCharts((prev) => ({ ...prev, [flow.flow_id]: !prev[flow.flow_id] }))}
                              className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 text-[12px]"
                            >{expandedTargetCharts[flow.flow_id] ? 'Show less' : 'Show more'}</button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-gray-300">No target demands.</div>
                    )}
                  </div>

                  {/* Ripple TV charts */}
                  {rippleTvIds.length > 0 && (
                    <div>
                      <div className="text-sm uppercase tracking-wider text-gray-300 mb-2">Ripples</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
                        {(() => {
                          const LIMIT = 12;
                          const showAll = !!expandedRippleCharts[flow.flow_id];
                          const list = showAll ? rippleTvIds : rippleTvIds.slice(0, LIMIT);
                          return list.map((tvId) => {
                            const seriesOpt = seriesView === 'demand'
                              ? (optFlow?.ripple_demands?.[tvId] || null)
                              : (optFlow?.ripple_occupancy_opt?.[tvId] || null);
                            return (
                              <HistogramCard
                                key={`r-${flow.flow_id}-${tvId}`}
                                tvId={tvId}
                                series={ripples[tvId] || []}
                                seriesB={seriesOpt}
                                minutesPerBin={minutesPerBin}
                                viewFrom={viewFrom}
                                viewTo={viewTo}
                                isControlled={false}
                                showLabels={showLabels}
                                attentionSet={rippleHighlights}
                                markerColor="#c084fc"
                              />
                            );
                          });
                          })()}
                      </div>
                      {rippleTvIds.length > 12 && (
                        <div className="mt-2">
                          <button
                            onClick={() => setExpandedRippleCharts((prev) => ({ ...prev, [flow.flow_id]: !prev[flow.flow_id] }))}
                            className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 text-[12px]"
                          >{expandedRippleCharts[flow.flow_id] ? 'Show less' : 'Show more'}</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
      <td className="px-3 py-2 text-white/70 text-[12px]">—</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            placeholder="value"
            type="number"
            value={valInput}
            onChange={(e) => setValInput(e.currentTarget.value)}
            className="w-32 px-2 py-1 bg-white/10 border border-white/20 rounded-md text-white"
            style={{ colorScheme: 'dark' }}
          />
          <button onClick={handleAdd} className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-[12px] text-white/80 hover:bg-white/15">Add</button>
        </div>
      </td>
    </tr>
  );
}

// Downloads removed per updated design.

function FlowsSummary({ flows, colors, optDelays }: { flows: Record<string, string[]>; colors: Record<string, string>; optDelays?: Record<string, number> | null }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setExpanded((prev) => ({ ...prev, [k]: !prev[k] }));
  const entries = Object.entries(flows || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const { flights } = useSimStore();

  function formatTime(seconds?: number): string {
    if (!Number.isFinite(seconds)) return 'N/A';
    const s = Math.max(0, Math.min(24 * 3600 - 1, Math.floor(seconds as number)));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  function resolveFlight(token: string) {
    // Prefer flightId match, fallback to callsign
    let f = flights.find(ff => String(ff.flightId) === String(token));
    if (!f) f = flights.find(ff => ff.callSign && String(ff.callSign) === String(token));
    return f;
  }

  const extraDelayFlightsWarning = useMemo(() => {
    const delays = optDelays || undefined;
    if (!delays) return null;
    const allInputFlightIds = new Set<string>();
    for (const ids of Object.values(flows || {})) {
      for (const token of (ids || [])) {
        const f = resolveFlight(String(token));
        if (f?.flightId) allInputFlightIds.add(String(f.flightId));
      }
    }
    const extra = Object.keys(delays).filter((fid) => !allInputFlightIds.has(String(fid)));
    if (extra.length === 0) return null;
    const preview = extra.slice(0, 5).join(', ');
    const more = extra.length > 5 ? ` and ${extra.length - 5} more` : '';
    return `Warning: optimization returned delays for flights not in your input: ${preview}${more}.`;
  }, [flows, optDelays, flights]);

  return (
    <div className="space-y-3">
      {extraDelayFlightsWarning && (
        <div className="text-[12px] text-rose-300">{extraDelayFlightsWarning}</div>
      )}
      {entries.map(([fid, ids]) => {
        const list = ids || [];
        const showAll = !!expanded[fid];
        const shown = showAll ? list : list.slice(0, 25);
        const color = colors?.[String(fid)] || '#60a5fa';
        return (
          <div key={fid} className="text-sm text-white/90">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
                <span>Flow {fid}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/70">{list.length} flights</span>
                {list.length > 25 && (
                  <button onClick={() => toggle(fid)} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[11px] text-white/80 hover:bg-white/15">
                    {showAll ? 'Show less' : 'Show all'}
                  </button>
                )}
              </div>
            </div>
            {list.length > 0 ? (
              <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
                <div className="overflow-visible">
                  <table className="w-full text-xs min-w-max whitespace-nowrap">
                    <thead className="sticky top-0 z-10 bg-blue-900">
                      <tr className="text-white">
                        <th className="text-left p-2 font-semibold">Callsign</th>
                        <th className="text-left p-2 font-semibold">Origin</th>
                        <th className="text-left p-2 font-semibold">Destination</th>
                        <th className="text-left p-2 font-semibold">Takeoff</th>
                        <th className="text-left p-2 font-semibold">Delay (min)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((token, i) => {
                        const f = resolveFlight(String(token));
                        const callsign = f?.callSign || String(token);
                        const origin = f?.origin || 'N/A';
                        const destination = f?.destination || 'N/A';
                        const takeoff = f ? formatTime(f.t0) : 'N/A';
                        const delayVal = (() => {
                          if (!optDelays) return null;
                          const key = f?.flightId ? String(f.flightId) : String(token);
                          const v = (optDelays as Record<string, number>)[key];
                          return Number.isFinite(v) ? Number(v) : null;
                        })();
                        return (
                          <tr key={`${fid}-${i}`} className={`border-b border-white/10 ${i % 2 === 0 ? 'bg-white/2' : ''}`}>
                            <td className="p-2 font-mono">{callsign}</td>
                            <td className="p-2">{origin}</td>
                            <td className="p-2">{destination}</td>
                            <td className="p-2 font-mono">{takeoff}</td>
                            <td className="p-2 font-mono">{delayVal === null ? '—' : delayVal}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-xs text-white/70">None</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
      const valueA = Number(series[i] ?? 0);
      const valueB = Number(Array.isArray(seriesB) ? seriesB[i] ?? 0 : 0);
      const isAttention = attentionSet.has(`${tvId}|${i}`);
      return { idx: i, valueA, valueB, startMin, isAttention };
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
              formatter={(val: any, name: any) => [String(val), name]}
            />
            <Bar dataKey="valueA" name="Baseline">
              {rows.map((r, i) => (
                <Cell key={`c-${i}`} fill={r.isAttention ? '#fb7185' : '#60a5fa'} />
              ))}
            </Bar>
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
            <span className="ml-1">→ <span className="font-mono text-white/90">{Number.isFinite(peakB.value) ? peakB.value : 0}</span></span>
          )} @{peakA.idx >= 0 ? binIndexToRangeLabel(peakA.idx, minutesPerBin) : '--'}
        </div>
        <div>Attention sum: <span className="font-mono text-white/90">{attentionSum}</span></div>
      </div>
    </div>
  );
}
