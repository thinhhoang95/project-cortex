"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import TimeScaleControl from "@/components/TimeScaleControl";
import ShimmeringText from "@/components/ShimmeringText";
import ModalDialog from "@/components/ModalDialog";
import { BaseEvaluationResponse, AutomaticRateAdjustmentResponse } from "@/lib/models";
import { useSimStore } from "@/components/useSimStore";
import { loadTrajectories } from "@/lib/flights";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie } from "recharts";
import { hhmmToMinutesSafe, minutesToHHMM, binIndexToRangeLabel } from "@/lib/time";
import OccupancyPrePostPanel from "@/components/OccupancyPrePostPanel";
import { FlowInputPayload } from "@/lib/flow-input";
import { AutorateOccupancyResponse } from "@/lib/autorate";
import {
  SolutionSnapshot,
  loadSnapshots,
  createSolutionSnapshot,
  addSnapshot,
  MAX_SNAPSHOTS,
  SnapshotLimitError,
  estimateSnapshotsSize,
  SNAPSHOT_SIZE_WARN_THRESHOLD,
  SNAPSHOT_STORAGE_KEY,
} from "@/lib/comparison";

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


function parseViewParam(v: string | null): { from: string; to: string } | null {
  if (!v) return null;
  const m = String(v).match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return null;
  return { from: m[1], to: m[2] };
}

export default function FlowEvaluationPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen w-screen overflow-x-hidden bg-slate-900 relative">
          <Header />
          <div className="pt-16 pb-12 px-6">
            <div className="max-w-7xl mx-auto">
              <div className="text-white/70 text-sm">Loading...</div>
            </div>
          </div>
        </main>
      }
    >
      <FlowEvaluationPageContent />
    </Suspense>
  );
}

function FlowEvaluationPageContent() {
  const router = useRouter();
  const user = useSimStore((state) => state.user);
  const [hydrated, setHydrated] = useState(false);
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
  const showLabels = true;
  const [showWeightDetails, setShowWeightDetails] = useState<boolean>(false);
  const [saParamsOverride, setSaParamsOverride] = useState<Record<string, number> | null>(null);
  const [rippleSummaryExpanded, setRippleSummaryExpanded] = useState<boolean>(false);
  const [expandedTargetCharts, setExpandedTargetCharts] = useState<Record<number, boolean>>({});
  const [expandedRippleCharts, setExpandedRippleCharts] = useState<Record<number, boolean>>({});
  const [expandedOccAll, setExpandedOccAll] = useState<boolean>(false);
  const [expandedOccOriginal, setExpandedOccOriginal] = useState<boolean>(false);
  // View toggle UI only (logic wiring to be handled later)
  const [seriesView, setSeriesView] = useState<'demand' | 'occupancy' | 'occupancy_all' | 'occupancy_original'>("demand");
  // Ripple TV sort mode (applies only to ripple TVs in Demand/Occupancy views)
  const [rippleSortMode, setRippleSortMode] = useState<'total' | 'abs_change'>("total");
  // Occupancy Flow/Total-Pre TV sort mode
  const [occOrigSortMode, setOccOrigSortMode] = useState<'total' | 'flow_absolute' | 'flow_relative' | 'exceedance'>("total");
  // Occupancy Pre-Post TV sort mode
  const [occAllSortMode, setOccAllSortMode] = useState<'total' | 'abs_change' | 'exceedance'>("total");
  const [snapshotPromptOpen, setSnapshotPromptOpen] = useState(false);
  const [snapshotDescription, setSnapshotDescription] = useState("");
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [snapshotSaveError, setSnapshotSaveError] = useState<string | null>(null);
  const [snapshotReplaceId, setSnapshotReplaceId] = useState<string | null>(null);
  const [snapshotList, setSnapshotList] = useState<SolutionSnapshot[]>([]);
  const [snapshotToast, setSnapshotToast] = useState<
    { message: string; action?: { label: string; href: string }; kind?: 'info' | 'warning' } | null
  >(null);

  useEffect(() => {
    const unsub = useSimStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useSimStore.persist.hasHydrated());
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (hydrated && !user) {
      router.push('/login');
    }
  }, [hydrated, user, router]);

  // Initialize default histogram view range once based on earliest target "from" time
  const didInitViewDefault = useRef<boolean>(false);
  useEffect(() => {
    if (didInitViewDefault.current) return;
    if (viewParam) return; // respect explicit URL view
    const targets = input?.targets || {};
    const fromMinutes: number[] = Object.values(targets)
      .map((tw) => hhmmToMinutesSafe(tw?.from))
      .filter((m) => Number.isFinite(m));
    if (fromMinutes.length === 0) return;
    const minFrom = Math.min(...fromMinutes);
    const newFrom = minutesToHHMM(minFrom);
    const newTo = minutesToHHMM(Math.min(1439, minFrom + 240)); // 4 hours window, clamped to end of day
    setViewFrom(newFrom);
    setViewTo(newTo);
    didInitViewDefault.current = true;
  }, [input?.targets, viewParam]);

  const [occAllState, setOccAllState] = useState<{ loading: boolean; error: string | null; data: AutorateOccupancyResponse | null }>({ loading: false, error: null, data: null });

  // Original counts state for Occupancy Flow/Total view
  type CountsResponse = {
    time_bin_minutes?: number;
    counts?: Record<string, number[]>;
    mentioned_counts?: Record<string, number[]>;
    capacity?: Record<string, number[]>;
    mentioned_capacity?: Record<string, number[]>;
    metadata?: Record<string, any>;
    timebins?: { labels?: string[]; start_bin?: number; end_bin?: number };
  };
  const [origCountsState, setOrigCountsState] = useState<{ loading: boolean; error: string | null; data: CountsResponse | null }>({ loading: false, error: null, data: null });

  const minutesPerBin = useMemo(() => {
    // Prefer explicit minutes from Occupancy Pre-Post response if present
    if (occAllState.data?.time_bin_minutes && Number.isFinite(occAllState.data.time_bin_minutes)) {
      return Math.max(1, Math.round(occAllState.data.time_bin_minutes));
    }
    const T = evalState.data?.num_time_bins || optState.data?.num_time_bins;
    if (!T || !Number.isFinite(T)) return 15; // default
    // Round to integer minutes per bin; tolerate non-divisible day
    return Math.max(1, Math.round(1440 / (T as number)));
  }, [occAllState.data?.time_bin_minutes, evalState.data?.num_time_bins, optState.data?.num_time_bins]);
  const snapshotCount = snapshotList.length;
  const snapshotSizeBytes = useMemo(() => estimateSnapshotsSize(snapshotList), [snapshotList]);
  const snapshotSizeWarn = snapshotSizeBytes > SNAPSHOT_SIZE_WARN_THRESHOLD;
  const snapshotSizeDisplayKb = Math.max(0, Math.round(snapshotSizeBytes / 1024));

  async function handleSelectOccupancyAll(force = false): Promise<AutorateOccupancyResponse | null> {
    if (!force && occAllState.data) {
      return occAllState.data;
    }
    if (!input) {
      setOccAllState({ loading: false, error: 'No input payload provided.', data: null });
      return null;
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
        const optRes = await (await import("@/lib/auth")).authFetch("/api/automatic_rate_adjustment", {
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
      const occRes = await (await import("@/lib/auth")).authFetch("/api/autorate_occupancy", {
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
      return occJson;
    } catch (e: any) {
      setOccAllState({ loading: false, error: e?.message || 'Failed to fetch Occupancy Pre-Post aggregation', data: null });
      return null;
    }
  }

  // Build union of TVs that appear in any flow's occupancy series (target or ripple)
  const tvUnion = useMemo(() => {
    const s = new Set<string>();
    for (const fl of (evalState.data?.flows || [])) {
      const t = fl.target_occupancy || {};
      const r = fl.ripple_occupancy || {};
      for (const k of Object.keys(t)) s.add(String(k));
      for (const k of Object.keys(r)) s.add(String(k));
    }
    return s;
  }, [evalState.data?.flows]);

  // Fetch original counts when Occupancy Flow/Total is selected
  const lastOrigKeyRef = useRef<string | null>(null);
  async function handleSelectOccupancyOriginal() {
    const ids = Array.from(tvUnion);
    if (!ids || ids.length === 0) {
      setOrigCountsState({ loading: false, error: null, data: null });
      return;
    }
    try {
      const key = JSON.stringify(ids.slice().sort());
      if (lastOrigKeyRef.current === key && origCountsState.data) return;
      setOrigCountsState({ loading: true, error: null, data: null });
      const body = { traffic_volume_ids: ids, rolling_hour: false, rank_by: 'total_count' } as any;
      const res = await (await import("@/lib/auth")).authFetch("/api/original_counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `original_counts failed: ${res.status}`);
      }
      const json = (await res.json()) as CountsResponse;
      setOrigCountsState({ loading: false, error: null, data: json });
      lastOrigKeyRef.current = key;
    } catch (e: any) {
      setOrigCountsState({ loading: false, error: e?.message || 'Failed to fetch original counts', data: null });
    }
  }

  // Auto-fetch when tab is active and inputs change
  useEffect(() => {
    if (seriesView === 'occupancy_original') {
      void handleSelectOccupancyOriginal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesView, tvUnion, evalState.data?.flows]);

  useEffect(() => {
    if (autostart && input && !evalState.data && !evalState.loading) {
      void handleRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, input]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSnapshotList(loadSnapshots());
    const onStorage = (ev: StorageEvent) => {
      if (ev.key && ev.key !== SNAPSHOT_STORAGE_KEY) return;
      setSnapshotList(loadSnapshots());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!snapshotToast) return;
    const id = window.setTimeout(() => setSnapshotToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [snapshotToast]);

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
      const res = await (await import("@/lib/auth")).authFetch("/api/base_evaluation", {
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
      const res = await (await import("@/lib/auth")).authFetch("/api/automatic_rate_adjustment", {
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
      // If user is currently viewing Occupancy Pre-Post, switch back to Rate (Demand)
      // to avoid presenting stale aggregated occupancy (which updates only on tab switch).
      if (seriesView === 'occupancy_all') {
        setSeriesView('demand');
      }
    } catch (e: any) {
      setOptState({ loading: false, error: e?.message || "Failed to run optimization", data: null });
    }
  };

  const handleOpenSnapshotPrompt = () => {
    if (!optState.data || !input) return;
    const existing = loadSnapshots();
    setSnapshotList(existing);
    const baseName = `Solution ${existing.length + 1}`;
    setSnapshotDescription(baseName);
    setSnapshotReplaceId(existing.length >= MAX_SNAPSHOTS ? existing[0]?.id ?? null : null);
    setSnapshotSaveError(null);
    setSnapshotPromptOpen(true);
  };

  const handleSaveSnapshot = async () => {
    if (!input || !optState.data) return;
    setSnapshotSaving(true);
    setSnapshotSaveError(null);
    try {
      const occupancyData = await handleSelectOccupancyAll(true);
      const payloadForSnapshot: FlowInputPayload = {
        flows: { ...(input.flows || {}) },
        targets: { ...(input.targets || {}) },
      };
      if (input.ripples) payloadForSnapshot.ripples = { ...input.ripples };
      if (typeof input.auto_ripple_time_bins !== 'undefined') payloadForSnapshot.auto_ripple_time_bins = input.auto_ripple_time_bins;
      if (input.indexer_path) payloadForSnapshot.indexer_path = input.indexer_path;
      if (input.flights_path) payloadForSnapshot.flights_path = input.flights_path;
      if (input.capacities_path) payloadForSnapshot.capacities_path = input.capacities_path;
      if (input.colorsByFlow) payloadForSnapshot.colorsByFlow = { ...input.colorsByFlow };
      const resolvedWeights = (() => {
        if (weightsOverride && Object.keys(weightsOverride).length > 0) return { ...weightsOverride };
        if (input.weights) return { ...input.weights };
        return undefined;
      })();
      if (resolvedWeights) payloadForSnapshot.weights = resolvedWeights;

      const snapshot = createSolutionSnapshot({
        description: snapshotDescription.trim() || `Solution ${snapshotList.length + 1}`,
        payload: payloadForSnapshot,
        weightsOverride: weightsOverride || null,
        weightsUsed: (optState.data?.weights_used as Record<string, number>)
          || (evalState.data?.weights_used as Record<string, number>)
          || null,
        saParamsOverride: saParamsOverride || null,
        saParamsUsed: (optState.data?.sa_params_used as Record<string, number>) || null,
        evaluation: evalState.data,
        optimization: optState.data,
        occupancy: occupancyData,
        minutesPerBin,
        shareUrl: encodedShareUrl,
      });

      const updated = addSnapshot(
        snapshot,
        snapshotReplaceId ? { replaceId: snapshotReplaceId } : undefined,
      );
      setSnapshotList(updated);
      setSnapshotPromptOpen(false);
      setSnapshotDescription("");
      setSnapshotReplaceId(null);
      const bytes = estimateSnapshotsSize(updated);
      const approxKb = Math.round(bytes / 1024);
      const occupancyAvailable = !!occupancyData;
      const baseMessage = snapshotReplaceId ? 'Snapshot replaced in comparison.' : 'Snapshot saved for comparison.';
      const toastMessage = occupancyAvailable
        ? baseMessage
        : `${baseMessage} Occupancy charts will show a placeholder until data is fetched from the comparison page.`;
      if (bytes > SNAPSHOT_SIZE_WARN_THRESHOLD) {
        setSnapshotToast({
          message: `${toastMessage} Storage is at ~${approxKb} KB; consider exporting or clearing soon.`,
          action: { label: 'Open Comparison', href: '/solution-comparison' },
          kind: 'warning',
        });
      } else {
        setSnapshotToast({
          message: toastMessage,
          action: { label: 'Open Comparison', href: '/solution-comparison' },
          kind: 'info',
        });
      }
    } catch (err: any) {
      if (err instanceof SnapshotLimitError) {
        setSnapshotSaveError(`Limit reached (${MAX_SNAPSHOTS}). Choose a snapshot to replace.`);
      } else {
        setSnapshotSaveError(err?.message || 'Failed to save snapshot.');
      }
    } finally {
      setSnapshotSaving(false);
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

  // Map optimization result flows by id for quick lookup
  const optFlowById = useMemo(() => {
    const mp = new Map<number, (AutomaticRateAdjustmentResponse["flows"][number])>();
    for (const f of (optState.data?.flows || [])) {
      mp.set(Number(f.flow_id), f);
    }
    return mp;
  }, [optState.data?.flows]);

  // Memoized per-flow ripple score maps for sorting
  const rippleScoreByFlowId = useMemo(() => {
    const scores = new Map<number, Record<string, number>>();
    const vFrom = hhmmToMinutesSafe(viewFrom);
    const vTo = hhmmToMinutesSafe(viewTo);
    const flows = evalState.data?.flows || [];
    for (const fl of flows) {
      const flowId = Number(fl.flow_id);
      const optFlow = optFlowById.get(flowId);
      const preOcc = fl.ripple_occupancy || {};
      const preDem = fl.ripple_demands || {};
      const postOcc = optFlow?.ripple_occupancy_opt || {};
      // Collect candidate ripple TV ids across occupancy/demand/post to ensure coverage
      const tvIds = Array.from(new Set<string>([
        ...Object.keys(preOcc || {}),
        ...Object.keys(preDem || {}),
        ...Object.keys(postOcc || {}),
      ].map(String)));

      const scoreByTv: Record<string, number> = {};
      for (const tvId of tvIds) {
        const pre = (preOcc?.[tvId] && Array.isArray(preOcc[tvId])) ? preOcc[tvId] : (preDem?.[tvId] || []);
        const postRaw = postOcc?.[tvId];
        const post = (postRaw && Array.isArray(postRaw)) ? postRaw : undefined;

        let score = 0;
        if (rippleSortMode === 'total') {
          const series = Array.isArray(post) && post.length > 0 ? post : pre || [];
          for (let i = 0; i < series.length; i++) {
            const startMin = i * minutesPerBin;
            if (startMin < vFrom || startMin > vTo) continue;
            const v = Number(series[i] ?? 0);
            score += Number.isFinite(v) ? v : 0;
          }
        } else {
          // abs_change: sum |post - pre| over in-view bins; treat missing post as 0 change (post = pre)
          const A = pre || [];
          const B = Array.isArray(post) ? post : (pre || []);
          const n = Math.min(A.length, B.length);
          for (let i = 0; i < n; i++) {
            const startMin = i * minutesPerBin;
            if (startMin < vFrom || startMin > vTo) continue;
            const a = Number(A[i] ?? 0);
            const b = Number(B[i] ?? 0);
            const aa = Number.isFinite(a) ? a : 0;
            const bb = Number.isFinite(b) ? b : 0;
            score += Math.abs(bb - aa);
          }
        }
        scoreByTv[String(tvId)] = score;
      }
      scores.set(flowId, scoreByTv);
    }
    return scores;
  }, [evalState.data?.flows, optFlowById, rippleSortMode, minutesPerBin, viewFrom, viewTo]);

  // Memoized scores for Occupancy Pre-Post sorting
  const occAllScoreByTv = useMemo(() => {
    const d = occAllState.data;
    const scores: Record<string, number> = {};
    if (!d) return scores;
    const minutes = Number(d.time_bin_minutes || minutesPerBin || 15);
    const vFrom = hhmmToMinutesSafe(viewFrom);
    const vTo = hhmmToMinutesSafe(viewTo);
    const pre = d.pre_counts || {};
    const post = d.post_counts || {};
    const capacities = d.capacity || {};
    const tvIds = Array.from(new Set<string>([
      ...Object.keys(pre || {}),
      ...Object.keys(post || {}),
      ...Object.keys(capacities || {}),
    ]));
    for (const tvId of tvIds) {
      const A = pre?.[tvId] || [];
      const B = post?.[tvId] || [];
      const C = capacities?.[tvId] || [];
      let score = 0;
      if (occAllSortMode === 'total') {
        const S = (Array.isArray(B) && B.length > 0) ? B : A;
        for (let i = 0; i < S.length; i++) {
          const startMin = i * minutes;
          if (startMin < vFrom || startMin > vTo) continue;
          const v = Number(S[i] ?? 0);
          score += Number.isFinite(v) ? v : 0;
        }
      } else if (occAllSortMode === 'abs_change') {
        const n = Math.min(A.length, B.length);
        for (let i = 0; i < n; i++) {
          const startMin = i * minutes;
          if (startMin < vFrom || startMin > vTo) continue;
          const a = Number(A[i] ?? 0);
          const b = Number(B[i] ?? 0);
          const aa = Number.isFinite(a) ? a : 0;
          const bb = Number.isFinite(b) ? b : 0;
          score += Math.abs(bb - aa);
        }
      } else {
        // exceedance: sum of positive (demand - capacity) over in-view bins using post if available else pre
        const S = (Array.isArray(B) && B.length > 0) ? B : A;
        const n = Math.min(S.length, C.length || S.length);
        for (let i = 0; i < n; i++) {
          const startMin = i * minutes;
          if (startMin < vFrom || startMin > vTo) continue;
          const dem = Number(S[i] ?? 0);
          const cap = Number(C?.[i] ?? Number.POSITIVE_INFINITY);
          const dd = Number.isFinite(dem) ? dem : 0;
          const cc = Number.isFinite(cap) ? cap : Number.POSITIVE_INFINITY;
          const ex = Math.max(0, dd - cc);
          score += ex;
        }
      }
      scores[String(tvId)] = score;
    }
    return scores;
  }, [occAllState.data, occAllSortMode, viewFrom, viewTo, minutesPerBin]);

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

  if (!hydrated || !user) {
    return null;
  }

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
              {optState.data && (
                <button
                  onClick={handleOpenSnapshotPrompt}
                  disabled={snapshotSaving}
                  className={`px-3 py-1 rounded-lg border text-xs flex items-center gap-2 ${snapshotSaving ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100' : 'border-emerald-400/70 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/25'}`}
                >
                  {snapshotSaving ? <ShimmeringText text="Saving…" /> : 'Add to Comparison'}
                  <span className={`px-2 py-0.5 rounded-full text-[11px] border ${snapshotSizeWarn ? 'border-red-300/70 bg-red-500/20 text-red-100' : 'border-emerald-300/70 bg-emerald-400/10 text-emerald-100'}`}>
                    {snapshotCount}/{MAX_SNAPSHOTS}
                  </span>
                </button>
              )}
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


          {/* Demand vs Occupancy toggle (adds Occupancy Pre-Post) */}
          <div className="mt-3 flex flex-wrap items-center gap-3 mb-6">
              <div className="text-[11px] uppercase tracking-wider text-white/60">Histogram Values</div>
              <div className="inline-flex rounded-md shadow-xs overflow-hidden" role="group" aria-label="Toggle view between Demand, Occupancy, Occupancy Flow/Total, and Occupancy Pre-Post">
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
                  Rate (Demand) by Flow
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
                  Occupancy by Flow
                </button>
                <button
                  type="button"
                  aria-pressed={seriesView === 'occupancy_original'}
                  onClick={async () => { setSeriesView('occupancy_original'); await handleSelectOccupancyOriginal(); }}
                  className={`px-3 py-1.5 text-[12px] font-medium border transition-colors -ml-px ${
                    seriesView === 'occupancy_original'
                      ? 'bg-blue-500/20 border-blue-400/60 text-white'
                      : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'
                  }`}
                >
                  Occupancy Flow/Total-Pre
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
                  Occupancy Pre-Post
                </button>
              </div>
              {(seriesView === 'demand' || seriesView === 'occupancy') && (
                <div className="ml-auto flex items-center gap-2">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Ripple TV Sort</div>
                  <select
                    className="px-2 py-1 text-[12px] rounded-md bg-white/10 border border-white/20 text-white/90 focus:outline-none"
                    value={rippleSortMode}
                    onChange={(e) => setRippleSortMode(e.currentTarget.value as 'total' | 'abs_change')}
                  >
                    <option value="total">Rank by Total</option>
                    <option
                      value="abs_change"
                      disabled={!optState.data}
                      title={!optState.data ? 'Run optimization to rank by changes.' : undefined}
                    >
                      Rank by Absolute Changes (Pre vs Post)
                    </option>
                  </select>
                </div>
              )}
              {seriesView === 'occupancy_original' && (
                <div className="ml-auto flex items-center gap-2">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">TV Sort</div>
                  <select
                    className="px-2 py-1 text-[12px] rounded-md bg-white/10 border border-white/20 text-white/90 focus:outline-none"
                    value={occOrigSortMode}
                    onChange={(e) => setOccOrigSortMode(e.currentTarget.value as 'total' | 'flow_absolute' | 'flow_relative' | 'exceedance')}
                  >
                    <option value="total">Rank by Total</option>
                    <option value="flow_absolute">Rank by Flow Absolute</option>
                    <option value="flow_relative">Rank by Flow Relative</option>
                    <option value="exceedance">By Exceedances</option>
                  </select>
                </div>
              )}
              {seriesView === 'occupancy_all' && (
                <div className="ml-auto flex items-center gap-2">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">TV Sort</div>
                  <select
                    className="px-2 py-1 text-[12px] rounded-md bg-white/10 border border-white/20 text-white/90 focus:outline-none"
                    value={occAllSortMode}
                    onChange={(e) => setOccAllSortMode(e.currentTarget.value as 'total' | 'abs_change' | 'exceedance')}
                  >
                    <option value="total">Rank by Total</option>
                    <option
                      value="abs_change"
                      disabled={!occAllState.data?.post_counts}
                      title={!occAllState.data?.post_counts ? 'Run optimization to get post counts for changes.' : undefined}
                    >
                      Rank by Absolute Changes (Pre vs Post)
                    </option>
                    <option value="exceedance">By Exceedances</option>
                  </select>
                </div>
              )}
            </div>

          {seriesView === 'occupancy_original' && (
            <section className="mb-8">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-white/60">Per-TV Occupancy Contributions vs Original</div>
                {origCountsState.loading && <div className="text-xs text-white/70">Loading...</div>}
              </div>
              {origCountsState.error && (
                <div className="text-xs text-rose-300 mb-2">{origCountsState.error}</div>
              )}
              {(() => {
                const d = origCountsState.data;
                const ids = Array.from(tvUnion);
                if (!d && ids.length === 0 && !origCountsState.loading) {
                  return <div className="text-xs text-gray-300">No TVs found in flow occupancy. Run evaluation first.</div>;
                }
                if (!d) return null;
                const minutes = Number(d.time_bin_minutes || minutesPerBin || 15);
                const mismatch = Number.isFinite(d.time_bin_minutes) && d.time_bin_minutes !== minutesPerBin;
                const vFrom = hhmmToMinutesSafe(viewFrom);
                const vTo = hhmmToMinutesSafe(viewTo);
                const counts = d.mentioned_counts || d.counts || {};
                const capacities = d.mentioned_capacity || d.capacity || {};

                // Colors for flows
                const allFlows = (evalState.data?.flows || []).map(f => f.flow_id).sort((a, b) => a - b);
                const palette = ['#60a5fa','#f59e0b','#34d399','#a78bfa','#f472b6','#f87171','#22d3ee','#eab308','#4ade80','#f97316','#c084fc','#06b6d4','#84cc16','#ef4444','#10b981'];
                const colorsByFlow: Record<number, string> = {};
                allFlows.forEach((fid, i) => {
                  const fromInput = input?.colorsByFlow?.[String(fid)] || null;
                  colorsByFlow[fid] = fromInput || palette[i % palette.length];
                });

                // Controlled TVs set
                const controlled = new Set<string>();
                for (const fl of (evalState.data?.flows || [])) {
                  if (fl.controlled_volume) controlled.add(String(fl.controlled_volume));
                }

                // Utility: build rows for one TV
                function buildRowsForTv(tvId: string) {
                  const original = counts[tvId] || [];
                  const capSeries = capacities?.[tvId];
                  const capAvail = Array.isArray(capSeries) && capSeries.some(v => Number.isFinite(v) && Number(v) >= 0);
                  const perFlow: Record<number, number[]> = {};
                  for (const fl of (evalState.data?.flows || [])) {
                    const fid = fl.flow_id;
                    let s: number[] | undefined = undefined;
                    if (fl.target_occupancy && Object.prototype.hasOwnProperty.call(fl.target_occupancy, tvId)) {
                      s = fl.target_occupancy[tvId];
                    } else if (fl.ripple_occupancy && Object.prototype.hasOwnProperty.call(fl.ripple_occupancy, tvId)) {
                      s = fl.ripple_occupancy[tvId];
                    }
                    if (!s || s.length === 0) continue;
                    perFlow[fid] = s.slice();
                  }
                  // Rolling-hour transform to match capacity semantics
                  const binsPerHour = Math.max(1, Math.round(60 / minutes));
                  function rollingSum(arr: number[], k: number): number[] {
                    const n = arr.length;
                    const out = new Array(n).fill(0);
                    let windowSum = 0;
                    for (let i = 0; i < n; i++) {
                      const v = Number(arr[i] ?? 0);
                      windowSum += Number.isFinite(v) ? v : 0;
                      if (i >= k) {
                        const old = Number(arr[i - k] ?? 0);
                        windowSum -= Number.isFinite(old) ? old : 0;
                      }
                      out[i] = windowSum;
                    }
                    return out;
                  }
                  const originalRolling = rollingSum(original, binsPerHour);
                  const perFlowRolling: Record<number, number[]> = {};
                  for (const [fidStr, arr] of Object.entries(perFlow)) {
                    perFlowRolling[Number(fidStr)] = rollingSum(arr || [], binsPerHour);
                  }
                  const T = Math.max(original.length, ...Object.values(perFlow).map(a => a.length));
                  const rows: Array<any> = new Array(T).fill(0).map((_, i) => {
                    const startMin = i * minutesPerBin;
                    const total = Number(originalRolling?.[i] ?? 0) || 0;
                    const entry: any = { idx: i, startMin, total };
                    let sumFlows = 0;
                    for (const fidStr of Object.keys(perFlow)) {
                      const fid = Number(fidStr);
                      const v = Number(perFlowRolling[fid]?.[i] ?? 0) || 0;
                      entry[`f_${fid}`] = v;
                      sumFlows += v;
                    }
                    entry.other = Math.max(0, total - sumFlows);
                    if (capAvail) {
                      const raw = capSeries?.[i];
                      const capNum = Number(raw);
                      entry.capacity = Number.isFinite(capNum) && capNum >= 0 ? capNum : null;
                    }
                    return entry;
                  });
                  const filtered = rows.filter(r => r.startMin >= vFrom && r.startMin <= vTo);
                  // Flow totals for ordering within this TV
                  const flowTotals: Array<{ fid: number; total: number }> = (Object.keys(perFlow).map(k => Number(k))).map(fid => ({
                    fid,
                    total: filtered.reduce((s, r) => s + (Number(r[`f_${fid}`]) || 0), 0)
                  }));
                  flowTotals.sort((a, b) => b.total - a.total || a.fid - b.fid);
                  const hasOverlap = filtered.some(r => {
                    const flowsSum = flowTotals.reduce((s, f) => s + (Number(r[`f_${f.fid}`]) || 0), 0);
                    return flowsSum > (Number(r.total) || 0);
                  });
                  return { rows: filtered, flowTotals, hasOverlap, hasCapacity: capAvail };
                }

                // Determine TV order: controlled first; then by selected metric within view window
                const tvIds = Array.from(new Set<string>([...Object.keys(counts)]));
                type TvScore = { tv: string; total: number; flowAbs: number; flowRel: number; exceed: number };
                const scores: Record<string, TvScore> = {};
                for (const tv of tvIds) {
                  const built = buildRowsForTv(tv);
                  const total = built.rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
                  const flowAbs = built.rows.reduce((s, r) => {
                    // Sum contributions from all known flows at this TV
                    let sum = 0;
                    for (const t of built.flowTotals) {
                      const v = Number(r[`f_${t.fid}`] ?? 0);
                      sum += Number.isFinite(v) ? v : 0;
                    }
                    return s + sum;
                  }, 0);
                  const flowRel = total > 0 ? flowAbs / total : 0;
                  // Exceedance using mentioned_capacity/capacity if present; otherwise 0
                  const capSeries = capacities?.[tv];
                  let exceed = 0;
                  if (Array.isArray(capSeries) && capSeries.length > 0) {
                    for (const r of built.rows) {
                      const i = r.idx;
                      const capVal = Number(capSeries?.[i]);
                      const cc = Number.isFinite(capVal) ? capVal : Number.POSITIVE_INFINITY;
                      const ex = Math.max(0, (Number(r.total) || 0) - cc);
                      exceed += ex;
                    }
                  }
                  scores[tv] = { tv, total, flowAbs, flowRel, exceed };
                }
                tvIds.sort((a, b) => {
                  const ac = controlled.has(a) ? 0 : 1;
                  const bc = controlled.has(b) ? 0 : 1;
                  if (ac !== bc) return ac - bc;
                  const sa = (
                    occOrigSortMode === 'total' ? scores[a].total :
                    occOrigSortMode === 'flow_absolute' ? scores[a].flowAbs :
                    occOrigSortMode === 'flow_relative' ? scores[a].flowRel :
                    scores[a].exceed
                  );
                  const sb = (
                    occOrigSortMode === 'total' ? scores[b].total :
                    occOrigSortMode === 'flow_absolute' ? scores[b].flowAbs :
                    occOrigSortMode === 'flow_relative' ? scores[b].flowRel :
                    scores[b].exceed
                  );
                  if (sa !== sb) return sb - sa;
                  return a.localeCompare(b);
                });

                if (tvIds.length === 0) return <div className="text-xs text-gray-300">No original counts available for selected TVs.</div>;

                const LIMIT = 12;
                const list = expandedOccOriginal ? tvIds : tvIds.slice(0, LIMIT);

                const legendFlows = (evalState.data?.flows || []).map(f => f.flow_id).sort((a, b) => a - b);

                return (
                  <>
                    {mismatch && (
                      <div className="text-[11px] text-amber-300 mb-2">Warning: bin size mismatch between evaluation ({minutesPerBin}m) and original counts ({d.time_bin_minutes}m).</div>
                    )}
                    {/* Legend */}
                    <div className="mb-2 flex flex-wrap gap-2 text-[12px] text-white/90">
                      {legendFlows.map(fid => (
                        <span key={`legend-${fid}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10">
                          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: colorsByFlow[fid] }} />
                          <span>Flow {fid}</span>
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10">
                        <span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#9ca3af' }} />
                        <span>Other</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
                      {list.map(tvId => {
                        const built = buildRowsForTv(tvId);
                        const rows = built.rows;
                        const flowOrder = built.flowTotals.map(t => t.fid);
                        return (
                          <div key={`occ-orig-${tvId}`} className="bg-white/5 border border-white/10 rounded-xl p-3 relative">
                            {built.hasOverlap && (
                              <div className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-400/60 text-rose-200">&gt;100%</div>
                            )}
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-sm font-semibold text-white flex items-center gap-2">
                                {controlled.has(tvId) && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-400/60 text-rose-200">Controlled</span>
                                )}
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
                                    contentStyle={{ background: "rgba(15,23,42,0.9)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
                                    formatter={(value, name, ctx: any) => {
                                      if (name === 'other') return [String(value), 'Other'];
                                      if (name === 'capacity') return [String(value), 'Capacity'];
                                      const m = String(name).match(/^f_(\d+)$/);
                                      if (m) return [String(value), `Flow ${m[1]}`];
                                      return [String(value), String(name)];
                                    }}
                                    labelFormatter={(label: any, payload: any) => {
                                      const i = Number(label ?? 0);
                                      const lbl = binIndexToRangeLabel(i, minutesPerBin);
                                      const p = Array.isArray(payload) && payload.length > 0 ? payload[0].payload : null;
                                      const total = p?.total ?? 0;
                                      return `${lbl}  |  total: ${total}`;
                                    }}
                                  />
                                  {flowOrder.map(fid => (
                                    <Bar key={`bar-${tvId}-${fid}`} dataKey={`f_${fid}`} stackId="flows" name={`Flow ${fid}`} fill={colorsByFlow[fid]} />
                                  ))}
                                  <Bar dataKey="other" stackId="flows" name="Other" fill="#9ca3af" />
                                  {built.hasCapacity && <Line type="stepAfter" dataKey="capacity" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />}
                                </ComposedChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {tvIds.length > LIMIT && (
                      <div className="mt-2">
                        <button
                          onClick={() => setExpandedOccOriginal((s) => !s)}
                          className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 text-[12px]"
                        >{expandedOccOriginal ? 'Show less' : 'Show more'}</button>
                      </div>
                    )}
                  </>
                );
              })()}
            </section>
          )}

          {seriesView === 'occupancy_all' && (
            <section className="mb-8">
              <OccupancyPrePostPanel
                title="Aggregated Occupancy Across Flows"
                postCounts={occAllState.data?.post_counts || {}}
                preCounts={occAllState.data?.pre_counts || {}}
                capacity={occAllState.data?.capacity || undefined}
                tvOrder={occAllState.data?.tv_ids_order || []}
                binMinutes={minutesPerBin}
                viewFrom={viewFrom}
                viewTo={viewTo}
                sortMode={occAllSortMode}
                onSortModeChange={(m) => setOccAllSortMode(m)}
                initialLimit={12}
                loading={occAllState.loading}
                error={occAllState.error}
              />
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

          {/* Per-flow results (hidden when aggregated views selected) */}
          {seriesView !== 'occupancy_all' && seriesView !== 'occupancy_original' && (
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
              const rippleScoreByTv = rippleScoreByFlowId.get(Number(flow.flow_id)) || {};
              const rippleTvIds = Object.keys(ripples).sort((a, b) => {
                const sa = Number(rippleScoreByTv[a] ?? 0);
                const sb = Number(rippleScoreByTv[b] ?? 0);
                if (sa !== sb) return sb - sa;
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
      <ModalDialog
        open={snapshotPromptOpen}
        onClose={() => { if (!snapshotSaving) setSnapshotPromptOpen(false); }}
        title="Save Optimized Solution"
        width="w-[min(520px,95vw)]"
        height="h-auto max-h-[85vh]"
      >
        <div className="p-6 space-y-5 text-sm">
          <div className="space-y-2">
            <p className="text-white/80 text-[13px]">
              Name this snapshot to compare it alongside other optimized runs. Aggregated occupancy data will be cached so the comparison page loads instantly.
            </p>
            <label className="block text-white/70 text-[12px] uppercase tracking-[0.08em]">Description</label>
            <input
              type="text"
              value={snapshotDescription}
              onChange={(e) => setSnapshotDescription(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !snapshotSaving) {
                  e.preventDefault();
                  void handleSaveSnapshot();
                }
              }}
              autoFocus
              placeholder="e.g., Alpha weights tweak"
              className="w-full px-3 py-2 rounded-md bg-white/10 border border-white/20 text-white focus:border-white/40 outline-none"
            />
          </div>

          {snapshotCount >= MAX_SNAPSHOTS && (
            <div className="space-y-2">
              <div className="text-[12px] text-amber-200">
                You already have {snapshotCount} snapshots. Select one to replace or cancel.
              </div>
              <select
                value={snapshotReplaceId || ''}
                onChange={(e) => setSnapshotReplaceId(e.currentTarget.value || null)}
                className="w-full px-3 py-2 rounded-md bg-white/10 border border-white/20 text-white focus:border-white/40 outline-none"
              >
                {snapshotList.map((snap) => (
                  <option key={snap.id} value={snap.id}>
                    {snap.description || 'Untitled'} · {new Date(snap.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="text-[12px] text-white/60">
            {occAllState.loading ? (
              <span className="flex items-center gap-2">
                <ShimmeringText text="Fetching aggregated occupancy…" />
              </span>
            ) : occAllState.data ? (
              'Latest autorate occupancy already cached for this run.'
            ) : (
              'Aggregated occupancy will be requested once during save.'
            )}
          </div>

          <div className="text-[12px] text-white/60">
            Approximate storage used: ~{snapshotSizeDisplayKb} KB (limit {MAX_SNAPSHOTS} snapshots).
          </div>

          {snapshotSaveError && (
            <div className="text-[12px] text-red-300">{snapshotSaveError}</div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              onClick={() => { if (!snapshotSaving) setSnapshotPromptOpen(false); }}
              disabled={snapshotSaving}
              className="px-3 py-1.5 rounded-md border border-white/20 bg-white/5 text-white/80 hover:bg-white/10 text-[13px] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSaveSnapshot()}
              disabled={snapshotSaving || (snapshotCount >= MAX_SNAPSHOTS && !snapshotReplaceId)}
              className="px-4 py-1.5 rounded-md border border-emerald-300 bg-emerald-500/30 text-emerald-50 hover:bg-emerald-500/40 text-[13px] font-medium disabled:opacity-60"
            >
              {snapshotSaving ? 'Saving…' : 'Save Snapshot'}
            </button>
          </div>
        </div>
      </ModalDialog>

      {snapshotToast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm flex items-start gap-3 ${snapshotToast.kind === 'warning' ? 'bg-amber-500/15 border-amber-300/60 text-amber-100' : 'bg-emerald-500/15 border-emerald-300/60 text-emerald-100'}`}
        >
          <div className="flex-1 text-sm">
            <div>{snapshotToast.message}</div>
            {snapshotToast.action && (
              <a
                href={snapshotToast.action.href}
                className="mt-1 inline-flex items-center gap-1 text-[12px] underline"
              >
                {snapshotToast.action.label}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"></path>
                  <path d="M12 5l7 7-7 7"></path>
                </svg>
              </a>
            )}
          </div>
          <button
            onClick={() => setSnapshotToast(null)}
            className="text-[12px] text-white/70 hover:text-white"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}
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
        const color = colors?.[String(fid)] || '#0f468a';
        return (
          <div key={fid} className="text-[12px] text-white/90">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} />
                <span className="font-medium text-sm opacity-90">Flow {fid}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-white/70">
                <span>{list.length} flights</span>
                {list.length > 25 && (
                  <button onClick={() => toggle(fid)} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[11px] text-white/80 hover:bg-white/15">
                    {showAll ? 'Show less' : 'Show all'}
                  </button>
                )}
              </div>
            </div>
            {list.length > 0 ? (
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-[11px]">
                    <thead>
                      <tr className="bg-white/10 text-white/80">
                        <th className="text-left p-2 font-semibold">Callsign</th>
                        <th className="text-left p-2 font-semibold">Origin</th>
                        <th className="text-left p-2 font-semibold">Destination</th>
                        <th className="text-right p-2 font-semibold">Takeoff</th>
                        <th className="text-right p-2 font-semibold">Delay (min)</th>
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
                          <tr
                            key={`${fid}-${i}`}
                            className={`border-t border-white/10 ${i % 2 === 0 ? 'bg-white/0' : 'bg-white/5'} hover:bg-white/10`}
                          >
                            <td className="p-2 font-mono">{callsign}</td>
                            <td className="p-2">{origin}</td>
                            <td className="p-2">{destination}</td>
                            <td className="p-2 text-right font-mono">{takeoff}</td>
                            <td className="p-2 text-right font-mono">{delayVal === null ? '—' : delayVal}</td>
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
                <Cell key={`c-${i}`} fill={r.isAttention ? '#fb7185' : '#0f468a'} />
              ))}
            </Bar>
            {Array.isArray(seriesB) && <Bar dataKey="valueB" name="Optimized" fill="#34d399" />}
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
