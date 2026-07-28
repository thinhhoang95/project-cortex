"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import TimeScaleControl from "@/components/TimeScaleControl";
import ShimmeringText from "@/components/ShimmeringText";
import ModalDialog from "@/components/ModalDialog";
import GlobalTVBasket from "@/components/GlobalTVBasket";
import { useGlobalTVBasket } from "@/components/useGlobalTVBasket";
import { buildGlobalTvBasketScope } from "@/lib/globalTvBasket";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import PerAccDelayAttributionPanel from "@/components/PerAccDelayAttributionPanel";
import {
  AutomaticRateAdjustmentSearchParams,
  BaseEvaluationResponse,
  AutomaticRateAdjustmentResponse,
  RegulationPlanPerAccAttrib,
  RegulationPlanPerAccAttribMode,
  type Trajectory,
} from "@/lib/models";
import { useSimStore } from "@/components/useSimStore";
import { useHotspotSettingsStore } from "@/components/useHotspotSettingsStore";
import { loadTrajectories } from "@/lib/flights";
import { getFlightsCsvPath } from "@/lib/dataPaths";
import { normalizeCapacity } from "@/lib/capacity";
import { resolveHotspotColor } from "@/lib/hotspotColoring";
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
  BarChart,
  Legend,
} from "recharts";
import { hhmmToMinutesSafe, minutesToHHMM, binIndexToRangeLabel } from "@/lib/time";
import OccupancyPrePostPanel, {
  type OccupancyPrePostSortMode,
} from "@/components/OccupancyPrePostPanel";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import { buildFlightIdIndex, buildUniqueCallsignIndex } from "@/lib/flightIdentity";
import { FlowInputPayload, sanitizeFlowInputPayload } from "@/lib/flow-input";
import { AutorateOccupancyResponse } from "@/lib/autorate";
import { normalizePerAccAttribMode } from "@/lib/perAccAttribution";
import TrafficVolumeInfoTooltip from "@/components/TrafficVolumeInfoTooltip";
import TrafficOverloadBar, { TrafficOverloadDatum } from "@/components/TrafficOverloadBar";
import { useResourceDateGuard } from "@/components/useResourceDateGuard";
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
import {
  PER_ACC_COMPARISON_MODES,
  clonePerAccAttrib,
  type StoredPerAccAttribByMode,
} from "@/lib/perAccComparison";
import { commitResourceStateHistory } from "@/lib/resourceContextClient";
import {
  refreshResourceStateFromServer,
  ResourceDateOutOfSyncError,
} from "@/lib/resourceStateSync";
import { buildResourceStateHistoryCommitFromFlowOptimization } from "@/lib/regulationStateCommit";

type FetchState = { loading: boolean; error: string | null; data: BaseEvaluationResponse | null };
type OptFetchState = { loading: boolean; error: string | null; data: AutomaticRateAdjustmentResponse | null };

const KNOWN_WEIGHT_DEFINITIONS: Array<{ key: string; description: string }> = [
  { key: "alpha_gt", description: "Penalty on rolling-hour capacity exceedance in target cells (J_cap)." },
  { key: "alpha_rip", description: "Penalty on rolling-hour exceedance in ripple cells (J_cap)." },
  { key: "alpha_ctx", description: "Penalty on rolling-hour exceedance in context cells (J_cap)." },
  { key: "beta_gt", description: "Weight on |n_f(t) − d_f(t)| for target bins (J_reg)." },
  { key: "beta_rip", description: "Weight on |n_f(t) − d_f(t)| for ripple bins (J_reg)." },
  { key: "beta_ctx", description: "Weight on |n_f(t) − d_f(t)| for context/overflow bins (J_reg)." },
  { key: "gamma_gt", description: "Weight on temporal variation |n_f(t+1) − n_f(t)| for target bins (J_tv)." },
  { key: "gamma_rip", description: "Weight on temporal variation for ripple bins (J_tv)." },
  { key: "gamma_ctx", description: "Weight on temporal variation for context/overflow bins (J_tv)." },
  { key: "lambda_delay", description: "Multiplier on total pushback delay minutes (J_delay)." },
  { key: "theta_share", description: "Weight on per-bin deviation of flow shares from demand shares (J_share)." },
  { key: "eta_spill", description: "Penalty per unit released into overflow bin T (J_spill)." },
  { key: "class_tolerance_w", description: "Bin tolerance w for GT/RIP classification (affects β/γ class only)." },
];

type SearchParamNumericKey = Exclude<keyof AutomaticRateAdjustmentSearchParams, "initial_rate_by_flow">;

const GRID_SEARCH_PARAM_DEFINITIONS: Array<{
  key: SearchParamNumericKey;
  description: string;
  defaultValue?: number;
  step?: string;
}> = [
  {
    key: "percent_lower",
    description: "Lower percent-cut bound for candidate rates. Accepts normalized values like 0.15 or whole-number percent values like 15.",
    defaultValue: 0.15,
    step: "0.01",
  },
  {
    key: "percent_upper",
    description: "Upper percent-cut bound for candidate rates. Accepts normalized values like 0.85 or whole-number percent values like 85.",
    defaultValue: 0.85,
    step: "0.01",
  },
  {
    key: "percent_step",
    description: "Inclusive step between percent-cut candidates. Must be greater than 0.",
    defaultValue: 0.1,
    step: "0.01",
  },
  {
    key: "max_joint_variants",
    description: "Maximum Cartesian-product candidates evaluated across all flows before the API rejects the request.",
    defaultValue: 4096,
    step: "1",
  },
  {
    key: "rate_change_lower_bound_min",
    description: "Expand each flow's active-bin window earlier by this many minutes before deriving the rate grid.",
    defaultValue: 0,
    step: "1",
  },
  {
    key: "rate_change_upper_bound_min",
    description: "Expand each flow's active-bin window later by this many minutes before deriving the rate grid.",
    defaultValue: 0,
    step: "1",
  },
  {
    key: "initial_rate_scale",
    description: "Multiplier applied to the derived demand-based initial hourly rate when no manual initial rate override is supplied.",
    defaultValue: 1,
    step: "0.01",
  },
  {
    key: "initial_rate",
    description: "Optional global manual initial hourly rate. Leave blank to use the derived rate times the scale.",
    step: "1",
  },
];

function cloneNumericRecord(src?: Record<string, number> | null): Record<string, number> | undefined {
  if (!src) return undefined;
  const entries = Object.entries(src).filter(([, value]) => Number.isFinite(Number(value)));
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, value]) => [key, Number(value)]));
}

function mergeWeights(
  base?: Record<string, number> | null,
  override?: Record<string, number> | null,
): Record<string, number> | undefined {
  const merged = {
    ...(cloneNumericRecord(base) || {}),
    ...(cloneNumericRecord(override) || {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function cloneInitialRateByFlow(
  src?: Record<string, number> | null,
): Record<string, number> | undefined {
  if (!src) return undefined;
  const entries = Object.entries(src)
    .map(([key, value]) => [String(key), Number(value)] as const)
    .filter(([, value]) => Number.isFinite(value) && value >= 0);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function cloneSearchParams(
  params?: AutomaticRateAdjustmentSearchParams | null,
): AutomaticRateAdjustmentSearchParams | undefined {
  if (!params) return undefined;
  const next: AutomaticRateAdjustmentSearchParams = {};
  for (const { key } of GRID_SEARCH_PARAM_DEFINITIONS) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = value;
    }
  }
  const initialRateByFlow = cloneInitialRateByFlow(params.initial_rate_by_flow);
  if (initialRateByFlow) {
    next.initial_rate_by_flow = initialRateByFlow;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function mergeSearchParams(
  base?: AutomaticRateAdjustmentSearchParams | null,
  override?: AutomaticRateAdjustmentSearchParams | null,
): AutomaticRateAdjustmentSearchParams | undefined {
  const baseClone = cloneSearchParams(base) || {};
  const overrideClone = cloneSearchParams(override) || {};
  const merged: AutomaticRateAdjustmentSearchParams = { ...baseClone, ...overrideClone };
  if (overrideClone.initial_rate_by_flow) {
    merged.initial_rate_by_flow = overrideClone.initial_rate_by_flow;
  } else if (baseClone.initial_rate_by_flow) {
    merged.initial_rate_by_flow = baseClone.initial_rate_by_flow;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function parseInitialRateByFlowInput(raw: string): Record<string, number> {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("initial_rate_by_flow must be a JSON object keyed by flow id.");
  }
  const entries = Object.entries(parsed).map(([key, value]) => [String(key), Number(value)] as const);
  for (const [key, value] of entries) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Initial rate for flow ${key} must be a non-negative number.`);
    }
  }
  return Object.fromEntries(entries);
}

function normalizeCandidateRates(candidateRates?: number[] | null): number[] {
  if (!Array.isArray(candidateRates)) return [];
  const unique = new Set<number>();
  for (const raw of candidateRates) {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      unique.add(value);
    }
  }
  return Array.from(unique).sort((a, b) => b - a);
}

function formatRatePerHour(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Math.abs(value - Math.round(value)) < 1e-6 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded}/hr`;
}

function formatAverageRateStep(candidateRates?: number[] | null): string {
  const normalized = normalizeCandidateRates(candidateRates);
  if (normalized.length < 2) return "—";
  let totalStep = 0;
  for (let index = 1; index < normalized.length; index += 1) {
    totalStep += Math.abs(normalized[index - 1] - normalized[index]);
  }
  const averageStep = totalStep / (normalized.length - 1);
  return formatRatePerHour(averageStep);
}

function resolveGridSearchRangeLabel(
  candidateRates?: number[] | null,
  gridSearchRange?: string | number[] | Record<string, unknown> | null,
): string {
  const normalized = normalizeCandidateRates(candidateRates);
  if (normalized.length > 0) {
    const maxRate = normalized[0];
    const minRate = normalized[normalized.length - 1];
    if (maxRate === minRate) {
      return formatRatePerHour(maxRate);
    }
    return `${formatRatePerHour(maxRate)} → ${formatRatePerHour(minRate)}`;
  }

  if (typeof gridSearchRange === "string") {
    const trimmed = gridSearchRange.trim();
    return trimmed.length > 0 ? trimmed : "—";
  }
  if (Array.isArray(gridSearchRange)) {
    const values = gridSearchRange
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (values.length > 0) {
      const maxRate = Math.max(...values);
      const minRate = Math.min(...values);
      return maxRate === minRate
        ? formatRatePerHour(maxRate)
        : `${formatRatePerHour(maxRate)} → ${formatRatePerHour(minRate)}`;
    }
  }
  if (gridSearchRange && typeof gridSearchRange === "object") {
    const record = gridSearchRange as Record<string, unknown>;
    const lower = Number(
      record.min_rate ?? record.lower_rate ?? record.lower ?? record.min ?? record.start ?? Number.NaN,
    );
    const upper = Number(
      record.max_rate ?? record.upper_rate ?? record.upper ?? record.max ?? record.end ?? Number.NaN,
    );
    if (Number.isFinite(lower) && Number.isFinite(upper)) {
      return lower === upper
        ? formatRatePerHour(upper)
        : `${formatRatePerHour(Math.max(lower, upper))} → ${formatRatePerHour(Math.min(lower, upper))}`;
    }
  }
  return "—";
}

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
        <main className="min-h-screen w-screen overflow-x-hidden analytics-surface relative">
          <Header />
          <div className="pt-16 pb-12 px-6">
            <div className="max-w-7xl mx-auto">
              <ShimmeringText text="Loading..." className="text-sm text-white/70 font-normal" />
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
  const hotspotSettings = useHotspotSettingsStore((state) => state.settings);
  const resourceDate = useSimStore((state) => state.resourceDate);
  const resourceStateSelectedId = useSimStore((state) => state.resourceStateSelectedId);
  const resourceStateHeadId = useSimStore((state) => state.resourceStateHeadId);
  const resourceStateLoading = useSimStore((state) => state.resourceStateLoading);
  const syncResourceState = useSimStore((state) => state.syncResourceState);
  const clearResourceDate = useSimStore((state) => state.clearResourceDate);
  const clearResourceState = useSimStore((state) => state.clearResourceState);
  const setResourceStateLoading = useSimStore((state) => state.setResourceStateLoading);
  const setResourceStatePendingId = useSimStore((state) => state.setResourceStatePendingId);
  const setResourceStateError = useSimStore((state) => state.setResourceStateError);
  const setIsRegulationPanelOpen = useSimStore((state) => state.setIsRegulationPanelOpen);
  const clearSelectedTrafficVolumesFromStore = useSimStore((state) => state.clearSelectedTrafficVolumes);
  const clearRegulationTargetFlights = useSimStore((state) => state.clearRegulationTargetFlights);
  const resetProposalState = useSimStore((state) => state.resetProposalState);
  const setFlowViewEnabled = useSimStore((state) => state.setFlowViewEnabled);
  const setFlowCommunities = useSimStore((state) => state.setFlowCommunities);
  const setFlowPreviewGroupId = useSimStore((state) => state.setFlowPreviewGroupId);
  const setFlowPreviewFlightId = useSimStore((state) => state.setFlowPreviewFlightId);
  const setFlightLinePreviewFlightIds = useSimStore((state) => state.setFlightLinePreviewFlightIds);
  const { hydrated, ready, user } = useResourceDateGuard();
  const sp = useSearchParams();
  const payloadParam = sp?.get("payload") || null;
  const autostart = (sp?.get("autostart") || "0") === "1" || !!payloadParam;
  const viewParam = parseViewParam(sp?.get("view") || null);
  const { flights, setBaselineFlights } = useSimStore();

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
  const [showWeightsSection, setShowWeightsSection] = useState<boolean>(false);
  const [showHyperparamsSection, setShowHyperparamsSection] = useState<boolean>(false);
  const [searchParamsOverride, setSearchParamsOverride] = useState<AutomaticRateAdjustmentSearchParams | null>(null);
  const [initialRateByFlowDraft, setInitialRateByFlowDraft] = useState("");
  const [initialRateByFlowError, setInitialRateByFlowError] = useState<string | null>(null);
  const [rippleSummaryExpanded, setRippleSummaryExpanded] = useState<boolean>(false);
  const [expandedTargetCharts, setExpandedTargetCharts] = useState<Record<number, boolean>>({});
  const [expandedRippleCharts, setExpandedRippleCharts] = useState<Record<number, boolean>>({});
  const [expandedOccAll, setExpandedOccAll] = useState<boolean>(false);
  const [expandedOccOriginal, setExpandedOccOriginal] = useState<boolean>(false);
  // View toggle UI only (logic wiring to be handled later)
  const [seriesView, setSeriesView] = useState<'demand' | 'occupancy' | 'occupancy_all' | 'occupancy_original' | 'airports_delay'>("demand");
  // Ripple TV sort mode (applies only to ripple TVs in Demand/Occupancy views)
  const [rippleSortMode, setRippleSortMode] = useState<'total' | 'abs_change'>("total");
  // Occupancy Flow/Total-Pre TV sort mode
  const [occOrigSortMode, setOccOrigSortMode] = useState<'total' | 'flow_absolute' | 'flow_relative' | 'exceedance'>("total");
  // Occupancy Pre-Post TV sort mode
  const [occAllSortMode, setOccAllSortMode] = useState<OccupancyPrePostSortMode>("total");
  const [snapshotPromptOpen, setSnapshotPromptOpen] = useState(false);
  const [snapshotDescription, setSnapshotDescription] = useState("");
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [snapshotSaveError, setSnapshotSaveError] = useState<string | null>(null);
  const [snapshotReplaceId, setSnapshotReplaceId] = useState<string | null>(null);
  const [snapshotList, setSnapshotList] = useState<SolutionSnapshot[]>([]);
  const [snapshotToast, setSnapshotToast] = useState<
    { message: string; action?: { label: string; href: string }; kind?: 'info' | 'warning' } | null
  >(null);
  const [autoratePerAccAttribMode, setAutoratePerAccAttribMode] = useState<RegulationPlanPerAccAttribMode>("dwelling_spread");
  const [autoratePerAccAttribLoading, setAutoratePerAccAttribLoading] = useState(false);
  const [autoratePerAccAttribError, setAutoratePerAccAttribError] = useState<string | null>(null);
  const [commitRegulationPending, setCommitRegulationPending] = useState(false);
  const [commitRegulationError, setCommitRegulationError] = useState<string | null>(null);

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

  const handleResourceDateOutOfSync = useCallback(() => {
    clearResourceState();
    clearResourceDate();
    router.replace("/select-date?reason=out_of_sync");
  }, [clearResourceDate, clearResourceState, router]);

  const refreshFromServer = useCallback(async () => {
    await refreshResourceStateFromServer({
      expectedResourceDate: resourceDate,
      onOutOfSync: () => handleResourceDateOutOfSync(),
      syncResourceState,
    });
  }, [handleResourceDateOutOfSync, resourceDate, syncResourceState]);

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
  const weightsUsedResolved = useMemo(
    () => ({
      ...((evalState.data?.weights_used || {}) as Record<string, number>),
      ...((optState.data?.weights_used || {}) as Record<string, number>),
    }),
    [evalState.data?.weights_used, optState.data?.weights_used],
  );
  const mergedWeights = useMemo(
    () => mergeWeights(input?.weights, weightsOverride),
    [input?.weights, weightsOverride],
  );
  const searchParamsUsedResolved = useMemo(
    () => cloneSearchParams(optState.data?.search_params_used ?? optState.data?.sa_params_used) || null,
    [optState.data?.search_params_used, optState.data?.sa_params_used],
  );
  const mergedSearchParams = useMemo(
    () => mergeSearchParams(input?.search_params, searchParamsOverride),
    [input?.search_params, searchParamsOverride],
  );
  const resolvedInitialRateByFlowForDisplay = useMemo(
    () =>
      cloneInitialRateByFlow(
        searchParamsOverride?.initial_rate_by_flow
          ?? input?.search_params?.initial_rate_by_flow
          ?? searchParamsUsedResolved?.initial_rate_by_flow,
      ) || null,
    [
      input?.search_params?.initial_rate_by_flow,
      searchParamsOverride?.initial_rate_by_flow,
      searchParamsUsedResolved?.initial_rate_by_flow,
    ],
  );
  const weightKeysToDisplay = useMemo(() => {
    const sourceKeys = new Set<string>([
      ...Object.keys(input?.weights || {}),
      ...Object.keys(weightsUsedResolved),
      ...Object.keys(weightsOverride || {}),
    ]);
    const orderedKnown = KNOWN_WEIGHT_DEFINITIONS
      .map((definition) => definition.key)
      .filter((key) => sourceKeys.has(key));
    const extras = Array.from(sourceKeys)
      .filter((key) => !orderedKnown.includes(key))
      .sort((a, b) => a.localeCompare(b));
    return [...orderedKnown, ...extras];
  }, [input?.weights, weightsOverride, weightsUsedResolved]);
  const evaluationRequestPayload = useMemo(() => {
    if (!input) return null;
    const body: any = sanitizeFlowInputPayload(input) || { ...input };
    if (mergedWeights) {
      body.weights = mergedWeights;
    } else {
      delete body.weights;
    }
    delete body.search_params;
    delete body.per_acc_attrib_mode;
    delete body.colorsByFlow;
    return body;
  }, [input, mergedWeights]);
  const optimizationRequestPayload = useMemo(() => {
    if (!input) return null;
    const body: any = sanitizeFlowInputPayload(input) || { ...input };
    if (mergedWeights) {
      body.weights = mergedWeights;
    } else {
      delete body.weights;
    }
    if (mergedSearchParams) {
      body.search_params = mergedSearchParams;
    } else {
      delete body.search_params;
    }
    body.per_acc_attrib_mode = autoratePerAccAttribMode;
    delete body.colorsByFlow;
    return body;
  }, [autoratePerAccAttribMode, input, mergedSearchParams, mergedWeights]);

  useEffect(() => {
    const nextDraft = resolvedInitialRateByFlowForDisplay
      ? JSON.stringify(resolvedInitialRateByFlowForDisplay, null, 2)
      : "";
    setInitialRateByFlowDraft(nextDraft);
    setInitialRateByFlowError(null);
  }, [resolvedInitialRateByFlowForDisplay]);

  useEffect(() => {
    if (!input?.per_acc_attrib_mode) return;
    setAutoratePerAccAttribMode(normalizePerAccAttribMode(input.per_acc_attrib_mode));
  }, [input?.per_acc_attrib_mode]);

  const commitPreconditionError = useMemo(() => {
    if (!input) return "No flow plan payload is available to commit.";
    if (!optState.data) return "Run optimization before committing.";

    try {
      buildResourceStateHistoryCommitFromFlowOptimization({
        parentStateId: resourceStateHeadId ?? resourceStateSelectedId ?? "",
        input,
        result: optState.data,
        flights,
      });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Optimization result cannot be committed.";
    }
  }, [flights, input, optState.data, resourceStateHeadId, resourceStateSelectedId]);

  const trafficVolumeIds = useMemo<string[]>(() => {
    const ids = new Set<string>();
    const addFromRecord = (rec?: Record<string, unknown> | null) => {
      if (!rec) return;
      Object.keys(rec).forEach((key) => {
        if (key) ids.add(String(key));
      });
    };
    const addFromArray = (arr?: Array<string | number | null | undefined>) => {
      if (!Array.isArray(arr)) return;
      arr.forEach((value) => {
        if (value !== null && value !== undefined && value !== "") {
          ids.add(String(value));
        }
      });
    };

    for (const fl of (evalState.data?.flows || [])) {
      addFromRecord(fl.target_demands);
      addFromRecord(fl.target_occupancy);
      addFromRecord(fl.ripple_demands);
      addFromRecord(fl.ripple_occupancy);
    }
    for (const fl of (optState.data?.flows || [])) {
      addFromRecord(fl.target_demands);
      addFromRecord(fl.ripple_demands);
      addFromRecord(fl.target_occupancy_opt);
      addFromRecord(fl.ripple_occupancy_opt);
    }
    addFromArray(Object.keys(input?.targets || {}));
    addFromArray(Object.keys(input?.ripples || {}));

    if (occAllState.data) {
      addFromRecord(occAllState.data.pre_counts as Record<string, unknown> | undefined);
      addFromRecord(occAllState.data.post_counts as Record<string, unknown> | undefined);
      addFromRecord(occAllState.data.capacity as Record<string, unknown> | undefined);
      addFromArray(occAllState.data.tv_ids_order as string[] | undefined);
    }
    if (origCountsState.data) {
      addFromRecord(origCountsState.data.counts);
      addFromRecord(origCountsState.data.mentioned_counts);
      addFromRecord(origCountsState.data.capacity);
      addFromRecord(origCountsState.data.mentioned_capacity);
    }

    return Array.from(ids).sort((a, b) => a.localeCompare(b));
  }, [
    evalState.data?.flows,
    optState.data?.flows,
    input?.targets,
    input?.ripples,
    occAllState.data,
    origCountsState.data,
  ]);

  const basket = useGlobalTVBasket(trafficVolumeIds);
  const applyBasketScope = useCallback(
    (ids: readonly string[]) =>
      buildGlobalTvBasketScope({
        catalogIds: basket.catalogIds,
        contextIds: ids,
        pinnedIds: basket.pinnedTvIds,
        query: basket.searchQuery,
      }).orderedContextIds,
    [basket.catalogIds, basket.pinnedTvIds, basket.searchQuery],
  );

  const canRankOccAllChanges = useMemo(() => {
    const pre = occAllState.data?.pre_counts || {};
    const post = occAllState.data?.post_counts || {};
    const hasPre = Object.values(pre).some((series) => Array.isArray(series) && series.length > 0);
    const hasPost = Object.values(post).some((series) => Array.isArray(series) && series.length > 0);
    return hasPre && hasPost;
  }, [occAllState.data?.pre_counts, occAllState.data?.post_counts]);

  const occAllPostCountsForView = useMemo<Record<string, number[]>>(() => {
    const src = occAllState.data?.post_counts;
    if (!src) return {};
    return src;
  }, [occAllState.data?.post_counts]);

  const occAllPreCountsForView = useMemo<Record<string, number[]>>(() => {
    const src = occAllState.data?.pre_counts;
    if (!src) return {};
    return src;
  }, [occAllState.data?.pre_counts]);

  const occAllCapacityForView = useMemo<Record<string, number[]> | undefined>(() => {
    const src = occAllState.data?.capacity;
    if (!src) return undefined;
    const result: Record<string, number[]> = {};
    Object.entries(src).forEach(([tv, series]) => {
      // Filter out capacity values >998 so they don't affect y-axis scaling
      // Values >998 (like 9999 for unopened traffic volumes) are set to NaN
      // which will be treated as null in OccupancyPrePostPanel
      result[tv] = Array.isArray(series) 
        ? series.map((cap: number) => Number.isFinite(cap) && cap > 998 ? NaN : cap)
        : series;
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }, [occAllState.data?.capacity]);

  const hasOccAllCapacity = useMemo(() => {
    return Object.values(occAllCapacityForView || {}).some(
      (series) =>
        Array.isArray(series) &&
        series.some((value) => Number.isFinite(Number(value))),
    );
  }, [occAllCapacityForView]);

  const occAllTvOrderForView = useMemo<string[]>(() => {
    return occAllState.data?.tv_ids_order || [];
  }, [occAllState.data?.tv_ids_order]);

  type HandleSelectOccupancyAllOptions = {
    perAccAttribMode?: RegulationPlanPerAccAttribMode;
    preserveData?: boolean;
    suppressErrorState?: boolean;
    throwOnError?: boolean;
  };

  async function requestAutomaticRateAdjustmentForMode(
    perAccAttribMode: RegulationPlanPerAccAttribMode,
  ): Promise<AutomaticRateAdjustmentResponse> {
    if (!optimizationRequestPayload) {
      throw new Error("No input payload provided.");
    }

    const body: any = {
      ...optimizationRequestPayload,
      search_params: optimizationRequestPayload.search_params
        ? {
            ...optimizationRequestPayload.search_params,
            initial_rate_by_flow: optimizationRequestPayload.search_params.initial_rate_by_flow
              ? { ...optimizationRequestPayload.search_params.initial_rate_by_flow }
              : undefined,
          }
        : undefined,
    };
    body.per_acc_attrib_mode = perAccAttribMode;

    const optRes = await (await import("@/lib/auth")).authFetch("/api/automatic_rate_adjustment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!optRes.ok) {
      const text = await optRes.text();
      throw new Error(text || `Optimization failed: ${optRes.status}`);
    }
    return (await optRes.json()) as AutomaticRateAdjustmentResponse;
  }

  async function ensureAutorateResultForAggregation(): Promise<AutomaticRateAdjustmentResponse> {
    if (optState.data) return optState.data;
    const optJson = await requestAutomaticRateAdjustmentForMode(autoratePerAccAttribMode);
    setOptState({ loading: false, error: null, data: optJson });
    return optJson;
  }

  async function requestAutorateOccupancyAggregation(
    autorateResult: AutomaticRateAdjustmentResponse,
    perAccAttribMode: RegulationPlanPerAccAttribMode,
  ): Promise<AutorateOccupancyResponse> {
    const occRes = await (await import("@/lib/auth")).authFetch("/api/autorate_occupancy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        autorate_result: autorateResult,
        include_capacity: true,
        per_acc_attrib_mode: perAccAttribMode,
      }),
    });
    if (!occRes.ok) {
      const text = await occRes.text();
      throw new Error(text || `autorate_occupancy failed: ${occRes.status}`);
    }
    return (await occRes.json()) as AutorateOccupancyResponse;
  }

  async function handleSelectOccupancyAll(
    force = false,
    options: HandleSelectOccupancyAllOptions = {},
  ): Promise<AutorateOccupancyResponse | null> {
    const requestedMode = options.perAccAttribMode ?? autoratePerAccAttribMode;
    const preserveData = Boolean(options.preserveData);
    const suppressErrorState = Boolean(options.suppressErrorState);
    const throwOnError = Boolean(options.throwOnError);

    if (!force && occAllState.data) {
      return occAllState.data;
    }
    if (!input) {
      if (!suppressErrorState) {
        setOccAllState((prev) => ({
          loading: false,
          error: "No input payload provided.",
          data: preserveData ? prev.data : null,
        }));
      }
      if (throwOnError) {
        throw new Error("No input payload provided.");
      }
      return null;
    }

    try {
      setOccAllState((prev) => ({
        loading: true,
        error: suppressErrorState ? prev.error : null,
        data: preserveData ? prev.data : null,
      }));

      const autorateResult = await ensureAutorateResultForAggregation();
      const occJson = await requestAutorateOccupancyAggregation(autorateResult, requestedMode);
      setOccAllState({ loading: false, error: null, data: occJson });
      if (occJson.per_acc_attrib?.mode) {
        setAutoratePerAccAttribMode(normalizePerAccAttribMode(occJson.per_acc_attrib.mode));
      }
      return occJson;
    } catch (e: any) {
      const message = e?.message || "Failed to fetch Occupancy Pre-Post aggregation";
      setOccAllState((prev) => ({
        loading: false,
        error: suppressErrorState ? prev.error : message,
        data: preserveData ? prev.data : null,
      }));
      if (throwOnError) {
        throw (e instanceof Error ? e : new Error(message));
      }
      return null;
    }
  }

  async function handleRefreshAutoratePerAccAttrib(nextMode: RegulationPlanPerAccAttribMode) {
    if (autoratePerAccAttribLoading) return;
    const currentPayload = occAllState.data?.per_acc_attrib;
    const currentPayloadMode = currentPayload ? normalizePerAccAttribMode(currentPayload.mode) : null;
    if (currentPayload && currentPayloadMode === nextMode) {
      setAutoratePerAccAttribMode(currentPayloadMode);
      setAutoratePerAccAttribError(null);
      return;
    }
    if (!optState.data) {
      setAutoratePerAccAttribError("Run an optimization first to compute delay attributions.");
      return;
    }

    const fallbackUiMode = currentPayloadMode ?? autoratePerAccAttribMode;
    setAutoratePerAccAttribMode(nextMode);
    setAutoratePerAccAttribError(null);
    setAutoratePerAccAttribLoading(true);
    try {
      const optPerAccMode = optState.data?.per_acc_attrib?.mode
        ? normalizePerAccAttribMode(optState.data.per_acc_attrib.mode)
        : null;
      const needsAutorateRecompute =
        nextMode === "control_volume" && optPerAccMode !== "control_volume";

      if (needsAutorateRecompute) {
        if (!input) {
          throw new Error("No input payload provided.");
        }
        setOptState((prev) => ({ loading: true, error: null, data: prev.data }));
        const optJson = await requestAutomaticRateAdjustmentForMode(nextMode);
        setOptState({ loading: false, error: null, data: optJson });

        setOccAllState((prev) => ({ loading: true, error: prev.error, data: prev.data }));
        const occJson = await requestAutorateOccupancyAggregation(optJson, nextMode);
        setOccAllState({ loading: false, error: null, data: occJson });
        if (occJson.per_acc_attrib?.mode) {
          setAutoratePerAccAttribMode(normalizePerAccAttribMode(occJson.per_acc_attrib.mode));
        }
      } else {
        const refreshed = await handleSelectOccupancyAll(true, {
          perAccAttribMode: nextMode,
          preserveData: true,
          suppressErrorState: true,
          throwOnError: true,
        });
        if (!refreshed) {
          throw new Error("Failed to refresh ACC attribution.");
        }
      }
    } catch (e: any) {
      setOptState((prev) => ({ ...prev, loading: false }));
      setAutoratePerAccAttribMode(fallbackUiMode);
      setAutoratePerAccAttribError(e?.message || "Failed to refresh ACC attribution.");
    } finally {
      setAutoratePerAccAttribLoading(false);
    }
  }

  const occAllHasPerAccAttrib = Boolean(occAllState.data?.per_acc_attrib);
  const occAllPerAccAttribModeRaw = occAllState.data?.per_acc_attrib?.mode;
  useEffect(() => {
    if (!occAllHasPerAccAttrib) return;
    setAutoratePerAccAttribMode(normalizePerAccAttribMode(occAllPerAccAttribModeRaw));
    setAutoratePerAccAttribError(null);
  }, [occAllHasPerAccAttrib, occAllPerAccAttribModeRaw]);

  useEffect(() => {
    if (seriesView !== "airports_delay") return;
    if (!optState.data) return;
    if (occAllState.loading || autoratePerAccAttribLoading) return;
    if (occAllState.data) return;
    void handleSelectOccupancyAll(false, { perAccAttribMode: autoratePerAccAttribMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesView, optState.data, occAllState.data, occAllState.loading, autoratePerAccAttribLoading, autoratePerAccAttribMode]);

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
    setCommitRegulationPending(false);
    setCommitRegulationError(null);
  }, [input, optState.data]);

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
        if (!resourceDate) throw new Error("No resource date selected");
        const tracks = await loadTrajectories(getFlightsCsvPath(resourceDate));
        if (cancelled) return;
        setBaselineFlights(tracks);
      } catch (e) {
        console.warn("Failed to load flight trajectories for Flow Evaluation page", e);
      }
    })();
    return () => { cancelled = true; };
  }, [flights.length, resourceDate, setBaselineFlights]);

  const handleRun = async () => {
    if (!evaluationRequestPayload) return;
    setEvalState({ loading: true, error: null, data: null });
    try {
      const res = await (await import("@/lib/auth")).authFetch("/api/base_evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(evaluationRequestPayload),
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
    if (!optimizationRequestPayload) return;
    setOptState({ loading: true, error: null, data: null });
    try {
      const res = await (await import("@/lib/auth")).authFetch("/api/automatic_rate_adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(optimizationRequestPayload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      const json = (await res.json()) as AutomaticRateAdjustmentResponse;
      setOptState({ loading: false, error: null, data: json });
      setOccAllState({ loading: false, error: null, data: null });
      setAutoratePerAccAttribError(null);
      // If user is currently viewing Occupancy Pre-Post, switch back to Rate (Demand)
      // to avoid presenting stale aggregated occupancy (which updates only on tab switch).
      if (seriesView === 'occupancy_all') {
        setSeriesView('demand');
      }
    } catch (e: any) {
      setOptState({ loading: false, error: e?.message || "Failed to run optimization", data: null });
    }
  };

  const cleanupAfterCommit = useCallback(() => {
    useSimStore.setState({
      flowBasket: [],
      targetCells: [],
    });
    clearSelectedTrafficVolumesFromStore();
    clearRegulationTargetFlights();
    resetProposalState();
    setIsRegulationPanelOpen(false);
    setFlowViewEnabled(false);
    setFlowCommunities(null, null, null);
    setFlowPreviewGroupId(null);
    setFlowPreviewFlightId(null);
    setFlightLinePreviewFlightIds(new Set<string>());

    setInput(null);
    setWeightsOverride(null);
    setSearchParamsOverride(null);
    setInitialRateByFlowDraft("");
    setInitialRateByFlowError(null);
    setEvalState({ loading: false, error: null, data: null });
    setOptState({ loading: false, error: null, data: null });
    setOccAllState({ loading: false, error: null, data: null });
    setOrigCountsState({ loading: false, error: null, data: null });
    setSeriesView("demand");
    setRippleSummaryExpanded(false);
    setExpandedTargetCharts({});
    setExpandedRippleCharts({});
    setExpandedOccAll(false);
    setExpandedOccOriginal(false);
    setShowResponse(false);
    setShowOptResponse(false);
    setSnapshotPromptOpen(false);
    setSnapshotDescription("");
    setSnapshotSaveError(null);
    setSnapshotReplaceId(null);
    setAutoratePerAccAttribError(null);
    router.replace("/flow-evaluation");
  }, [
    clearRegulationTargetFlights,
    clearSelectedTrafficVolumesFromStore,
    resetProposalState,
    router,
    setFlowCommunities,
    setFlightLinePreviewFlightIds,
    setFlowPreviewFlightId,
    setFlowPreviewGroupId,
    setFlowViewEnabled,
    setIsRegulationPanelOpen,
  ]);

  const handleCommitRegulation = useCallback(async () => {
    if (!input || !optState.data) return;
    if (commitRegulationPending || resourceStateLoading) return;

    setCommitRegulationError(null);

    if (commitPreconditionError) {
      setCommitRegulationError(commitPreconditionError);
      return;
    }

    const parentStateId = resourceStateHeadId ?? resourceStateSelectedId ?? "";
    let commitPayload;
    try {
      commitPayload = buildResourceStateHistoryCommitFromFlowOptimization({
        parentStateId,
        input,
        result: optState.data,
        flights,
      });
    } catch (error) {
      setCommitRegulationError(
        error instanceof Error
          ? error.message
          : "Failed to prepare optimization commit payload.",
      );
      return;
    }

    setCommitRegulationPending(true);
    setResourceStateError(null);
    setResourceStatePendingId(parentStateId);
    setResourceStateLoading(true);

    let commitSucceeded = false;
    let committedStateId: string | null = null;

    try {
      const commitResponse = await commitResourceStateHistory(commitPayload);
      commitSucceeded = true;
      committedStateId =
        typeof (commitResponse as any)?.state?.state_id === "string"
          ? String((commitResponse as any).state.state_id).trim()
          : null;
      await refreshFromServer();
      cleanupAfterCommit();
    } catch (error) {
      if (error instanceof ResourceDateOutOfSyncError) {
        return;
      }

      console.error("Failed to commit flow optimization:", error);

      let recoveredByRefresh = false;
      try {
        await refreshFromServer();
        recoveredByRefresh = true;
      } catch (refreshError) {
        if (!(refreshError instanceof ResourceDateOutOfSyncError)) {
          console.error(
            "Failed to refresh resource state after flow optimization commit error:",
            refreshError,
          );
        }
      }

      if (commitSucceeded && recoveredByRefresh) {
        cleanupAfterCommit();
        return;
      }

      if (commitSucceeded) {
        const baseMessage =
          error instanceof Error
            ? error.message
            : "Failed to synchronize client state after commit.";
        setCommitRegulationError(
          committedStateId
            ? `Regulation committed as ${committedStateId}, but client synchronization failed. ${baseMessage}`
            : `Regulation committed, but client synchronization failed. ${baseMessage}`,
        );
        return;
      }

      setCommitRegulationError(
        error instanceof Error ? error.message : "Failed to commit regulation.",
      );
    } finally {
      setCommitRegulationPending(false);
      setResourceStatePendingId(null);
      setResourceStateLoading(false);
    }
  }, [
    cleanupAfterCommit,
    commitPreconditionError,
    commitRegulationPending,
    flights,
    input,
    optState.data,
    refreshFromServer,
    resourceStateHeadId,
    resourceStateLoading,
    resourceStateSelectedId,
    setResourceStateError,
    setResourceStateLoading,
    setResourceStatePendingId,
  ]);

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
      const occupancyData = await handleSelectOccupancyAll(true, {
        perAccAttribMode: autoratePerAccAttribMode,
        preserveData: true,
        suppressErrorState: true,
        throwOnError: true,
      });
      const perAccAttribByMode: StoredPerAccAttribByMode = {};
      const currentModeAttrib = clonePerAccAttrib(occupancyData?.per_acc_attrib);
      if (currentModeAttrib) {
        perAccAttribByMode[normalizePerAccAttribMode(currentModeAttrib.mode)] = currentModeAttrib;
      }

      const optPerAccMode = optState.data?.per_acc_attrib?.mode
        ? normalizePerAccAttribMode(optState.data.per_acc_attrib.mode)
        : null;
      let controlVolumeOptResult: AutomaticRateAdjustmentResponse | null = null;

      for (const mode of PER_ACC_COMPARISON_MODES) {
        if (perAccAttribByMode[mode]) continue;
        const autorateResult =
          mode === "control_volume" && optPerAccMode !== "control_volume"
            ? (controlVolumeOptResult ??= await requestAutomaticRateAdjustmentForMode("control_volume"))
            : optState.data!;
        const modeOccupancy = await requestAutorateOccupancyAggregation(autorateResult, mode);
        const nextAttrib = clonePerAccAttrib(modeOccupancy.per_acc_attrib);
        if (!nextAttrib) {
          throw new Error(`ACC attribution is unavailable for ${mode.replace(/_/g, " ")} mode.`);
        }
        perAccAttribByMode[mode] = nextAttrib;
      }

      const payloadForSnapshot = sanitizeFlowInputPayload(input) || {
        flows: { ...(input.flows || {}) },
        targets: { ...(input.targets || {}) },
      };
      if (mergedWeights) {
        payloadForSnapshot.weights = mergedWeights;
      } else {
        delete payloadForSnapshot.weights;
      }
      if (mergedSearchParams) {
        payloadForSnapshot.search_params = mergedSearchParams;
      } else {
        delete payloadForSnapshot.search_params;
      }
      payloadForSnapshot.per_acc_attrib_mode = autoratePerAccAttribMode;

      const snapshot = createSolutionSnapshot({
        description: snapshotDescription.trim() || `Solution ${snapshotList.length + 1}`,
        payload: payloadForSnapshot,
        weightsOverride: weightsOverride || null,
        weightsUsed: Object.keys(weightsUsedResolved).length > 0 ? weightsUsedResolved : null,
        searchParamsOverride: searchParamsOverride || null,
        searchParamsUsed: searchParamsUsedResolved,
        evaluation: evalState.data,
        optimization: optState.data,
        occupancy: occupancyData,
        perAccAttribByMode,
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
    const exceedanceNormalization = minutes > 0 ? minutes / 60 : 1;
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
      } else if (occAllSortMode === 'relative_change') {
        const n = Math.min(A.length, B.length);
        let deltaSum = 0;
        let baseSum = 0;
        for (let i = 0; i < n; i++) {
          const startMin = i * minutes;
          if (startMin < vFrom || startMin > vTo) continue;
          const a = Number(A[i] ?? 0);
          const b = Number(B[i] ?? 0);
          const aa = Number.isFinite(a) ? a : 0;
          const bb = Number.isFinite(b) ? b : 0;
          deltaSum += Math.abs(bb - aa);
          baseSum += Math.abs(aa);
        }
        if (baseSum > 0) {
          score = deltaSum / baseSum;
        } else {
          score = deltaSum > 0 ? Number.MAX_SAFE_INTEGER : 0;
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
          score += ex * exceedanceNormalization;
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
    const current = input ? (sanitizeFlowInputPayload(input) || { ...input }) : null;
    if (current) {
      if (mergedWeights) {
        current.weights = mergedWeights;
      } else {
        delete current.weights;
      }
      if (mergedSearchParams) {
        current.search_params = mergedSearchParams;
      } else {
        delete current.search_params;
      }
      current.per_acc_attrib_mode = autoratePerAccAttribMode;
    }
    const b64 = current ? encodePayloadParam(current) : "";
    const view = `${viewFrom}-${viewTo}`;
    const params = new URLSearchParams();
    if (b64) params.set("payload", b64);
    if (view) params.set("view", view);
    params.set("autostart", "1");
    return `/flow-evaluation?${params.toString()}`;
  }, [autoratePerAccAttribMode, input, mergedSearchParams, mergedWeights, viewFrom, viewTo]);

  if (!hydrated || !ready || !user) {
    return null;
  }

  return (
    <main key={resourceDate ?? "no-resource-date"} className="min-h-screen w-screen overflow-x-hidden analytics-surface relative">
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
                className={`px-3 py-1 rounded-lg border text-xs flex items-center gap-1.5 ${evalState.loading ? 'border-blue-400/50 bg-blue-500/20 text-blue-200' : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
              >
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 2.083C3 1.349 3.8.915 4.408 1.321l5.545 3.75a.667.667 0 0 1 0 1.059L4.408 9.88C3.8 10.285 3 9.851 3 9.117V2.083Z"/></svg>
                {evalState.loading ? <ShimmeringText text="Evaluating..." /> : 'Run Evaluation'}
              </button>

              <button
                onClick={handleOptimize}
                disabled={!input || evalState.loading || optState.loading}
                className={`px-3 py-1 rounded-lg border text-xs flex items-center gap-1.5 ${optState.loading ? 'border-purple-400/50 bg-purple-500/20 text-purple-200' : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
              >
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M5 1.5 5.8 3.5 7.5 4l-1.7.5L5 6.5 4.2 4.5 2.5 4l1.7-.5L5 1.5Zm4.5 5 .6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z"/></svg>
                {optState.loading ? <ShimmeringText text="Searching Joint Rate Grid..." /> : "Optimize Release Rates with Grid Search"}
              </button>
              <button
                type="button"
                onClick={() => void handleCommitRegulation()}
                disabled={!optState.data || commitRegulationPending || resourceStateLoading || !!commitPreconditionError}
                className={`px-3 py-1 rounded-lg border text-xs flex items-center gap-1.5 ${commitRegulationPending || resourceStateLoading || !optState.data || !!commitPreconditionError ? 'border-sky-300/30 bg-sky-500/10 text-sky-100/60 cursor-not-allowed' : 'border-sky-300/70 bg-sky-500/20 text-sky-50 hover:bg-sky-500/30'}`}
              >
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8V2M3.5 4.5 6 2l2.5 2.5"/><path d="M2 9.5v.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-.5"/></svg>
                {commitRegulationPending ? <ShimmeringText text="Committing…" /> : "Commit Regulation"}
              </button>
              {optState.data && (
                <button
                  onClick={handleOpenSnapshotPrompt}
                  disabled={snapshotSaving}
                  className={`ml-auto px-3 py-1 rounded-lg border text-xs flex items-center gap-2 ${snapshotSaving ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100' : 'border-emerald-400/70 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/25'}`}
                >
                  {snapshotSaving ? <ShimmeringText text="Saving…" /> : 'Add to Comparison'}
                  <span className={`px-2 py-0.5 rounded-full text-[11px] border ${snapshotSizeWarn ? 'border-red-300/70 bg-red-500/20 text-red-100' : 'border-emerald-300/70 bg-emerald-400/10 text-emerald-100'}`}>
                    {snapshotCount}/{MAX_SNAPSHOTS}
                  </span>
                </button>
              )}
              {optState.error && (
                <div className="flex items-start gap-1.5 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-300">
                  <svg className="w-3.5 h-3.5 shrink-0 mt-px" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="5.5"/><path d="M5 5l4 4m0-4-4 4"/></svg>
                  <span>{optState.error}</span>
                </div>
              )}
              {evalState.error && (
                <div className="flex items-start gap-1.5 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-300">
                  <svg className="w-3.5 h-3.5 shrink-0 mt-px" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="5.5"/><path d="M5 5l4 4m0-4-4 4"/></svg>
                  <span>{evalState.error}</span>
                </div>
              )}
            </div>
            {(commitRegulationError || (optState.data && commitPreconditionError)) && (
              <div className={`mt-1 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${commitRegulationError ? 'border-rose-400/30 bg-rose-500/10 text-rose-300' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}`}>
                {commitRegulationError ? (
                  <svg className="w-3.5 h-3.5 shrink-0 mt-px" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="5.5"/><path d="M5 5l4 4m0-4-4 4"/></svg>
                ) : (
                  <svg className="w-3.5 h-3.5 shrink-0 mt-px" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 1.5 12.5 11.5H1.5L7 1.5Z"/><path d="M7 5.5v2.5"/><circle cx="7" cy="9.5" r=".5" fill="currentColor" stroke="none"/></svg>
                )}
                <span>{commitRegulationError ?? commitPreconditionError}</span>
              </div>
            )}
            {!commitRegulationError && optState.data && !commitPreconditionError && (
              <div className="mt-1 text-[11px] text-emerald-200/70">
                Commit appends this optimized regulation episode on the server, clears the flow plan panels, and re-synchronizes resource state.
              </div>
            )}

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
                      const hiddenCount = Math.max(0, list.length - LIMIT);
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
                            >{rippleSummaryExpanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenCount)}</button>
                          )}
                        </>
                      );
                    }
                    const entries = Object.entries(input?.ripples || {}).sort((a, b) => a[0].localeCompare(b[0]));
                    if (entries.length === 0) return <div className="text-xs text-white/70">None</div>;
                    const shown = rippleSummaryExpanded ? entries : entries.slice(0, LIMIT);
                    const hiddenCount = Math.max(0, entries.length - LIMIT);
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
                          >{rippleSummaryExpanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenCount)}</button>
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
              <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">Objective Weights and Joint Search</div>
              <div className="space-y-4">
                <div>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between text-xs uppercase tracking-wider text-white/60 hover:text-white transition-colors mb-2"
                    onClick={() => setShowWeightsSection((v) => !v)}
                    aria-controls="weights-details-content"
                    aria-expanded={showWeightsSection}
                  >
                    <span>Objective Weights</span>
                    <svg
                      className={`w-4 h-4 text-white/70 transition-transform ${showWeightsSection ? "rotate-90" : ""}`}
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.21 5.23a.75.75 0 011.06 0l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-1.06L10.94 10 7.21 6.29a.75.75 0 010-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  {showWeightsSection && (
                    <div
                      className="bg-white/5 border border-white/10 rounded-lg overflow-hidden"
                      id="weights-details-content"
                      aria-hidden={!showWeightsSection}
                    >
                      <div className="border-b border-white/10 px-3 py-2 text-[11px] text-white/60">
                        Keys shown here are discovered from the current payload and the API&apos;s effective `weights_used` response.
                      </div>
                      <table className="w-full text-sm text-white/90">
                        <thead className="bg-white/5 text-white/70">
                          <tr>
                            <th className="text-left px-3 py-2">Weight key</th>
                            <th className="text-left px-3 py-2">Description</th>
                            <th className="text-left px-3 py-2">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {weightKeysToDisplay.length === 0 && (
                            <tr className="border-t border-white/10">
                              <td colSpan={3} className="px-3 py-3 text-[12px] text-white/60">
                                No weight keys are present yet. Run an evaluation or add a custom weight override below.
                              </td>
                            </tr>
                          )}
                          {weightKeysToDisplay.map((key) => {
                            const def = KNOWN_WEIGHT_DEFINITIONS.find((definition) => definition.key === key);
                            const hasOverride = Boolean(
                              weightsOverride && Object.prototype.hasOwnProperty.call(weightsOverride, key),
                            );
                            const inputValue = input?.weights?.[key];
                            const usedValue = weightsUsedResolved[key];
                            const displayVal = hasOverride
                              ? String(weightsOverride?.[key])
                              : typeof inputValue === "number"
                                ? String(inputValue)
                                : typeof usedValue === "number"
                                  ? String(usedValue)
                                  : "";
                            return (
                              <tr key={key} className="border-t border-white/10 align-top">
                                <td className="px-3 py-2 font-mono text-[12px] text-white/80 whitespace-nowrap">{key}</td>
                                <td className="px-3 py-2 text-white/70 text-[12px]">
                                  {def?.description || "Custom weight key"}
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    value={displayVal}
                                    onChange={(e) => {
                                      const raw = e.currentTarget.value;
                                      setWeightsOverride((prev) => {
                                        const base = { ...(prev || {}) } as Record<string, number>;
                                        if (raw === "") {
                                          delete base[key];
                                          return Object.keys(base).length > 0 ? base : null;
                                        }
                                        const num = Number(raw);
                                        if (!Number.isFinite(num)) return prev;
                                        base[key] = num;
                                        return base;
                                      });
                                    }}
                                    className="w-32 px-2 py-1 bg-white/10 border border-white/20 rounded-md text-white"
                                    style={{ colorScheme: "dark" }}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                          <WeightsAddRow onAdd={(key, val) => setWeightsOverride((prev) => ({ ...(prev || {}), [key]: val }))} />
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between text-xs uppercase tracking-wider text-white/60 hover:text-white transition-colors mb-2"
                    onClick={() => setShowHyperparamsSection((v) => !v)}
                    aria-controls="hyperparameters-details-content"
                    aria-expanded={showHyperparamsSection}
                  >
                    <span>Grid Search Parameters</span>
                    <svg
                      className={`w-4 h-4 text-white/70 transition-transform ${showHyperparamsSection ? "rotate-90" : ""}`}
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.21 5.23a.75.75 0 011.06 0l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-1.06L10.94 10 7.21 6.29a.75.75 0 010-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  {showHyperparamsSection && (
                    <div
                      className="bg-white/5 border border-white/10 rounded-lg overflow-hidden"
                      id="hyperparameters-details-content"
                      aria-hidden={!showHyperparamsSection}
                    >
                      <table className="w-full text-sm text-white/90">
                        <thead className="bg-white/5 text-white/70">
                          <tr>
                            <th className="text-left px-3 py-2">Parameter</th>
                            <th className="text-left px-3 py-2">Description</th>
                            <th className="text-left px-3 py-2">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {GRID_SEARCH_PARAM_DEFINITIONS.map(({ key, description, defaultValue, step }) => {
                            const overrideValue = searchParamsOverride?.[key];
                            const inputValue = input?.search_params?.[key];
                            const usedValue = searchParamsUsedResolved?.[key];
                            const resolvedValue = typeof overrideValue === "number"
                              ? overrideValue
                              : typeof inputValue === "number"
                                ? inputValue
                                : typeof usedValue === "number"
                                  ? usedValue
                                  : defaultValue;
                            const displayVal = typeof resolvedValue === "number" ? String(resolvedValue) : "";
                            return (
                              <tr key={key} className="border-t border-white/10 align-top">
                                <td className="px-3 py-2 font-mono text-[12px] text-white/80 whitespace-nowrap">{key}</td>
                                <td className="px-3 py-2 text-white/70 text-[12px]">{description}</td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    step={step}
                                    value={displayVal}
                                    onChange={(e) => {
                                      const raw = e.currentTarget.value;
                                      setSearchParamsOverride((prev) => {
                                        const base: AutomaticRateAdjustmentSearchParams = cloneSearchParams(prev) || {};
                                        if (raw === "") {
                                          delete base[key];
                                          return Object.keys(base).length > 0 ? base : null;
                                        }
                                        const num = Number(raw);
                                        if (!Number.isFinite(num)) return prev;
                                        base[key] = num;
                                        return Object.keys(base).length > 0 ? base : null;
                                      });
                                    }}
                                    className="w-32 px-2 py-1 bg-white/10 border border-white/20 rounded-md text-white"
                                    style={{ colorScheme: "dark" }}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="border-t border-white/10 align-top">
                            <td className="px-3 py-2 font-mono text-[12px] text-white/80 whitespace-nowrap">initial_rate_by_flow</td>
                            <td className="px-3 py-2 text-white/70 text-[12px]">
                              Optional per-flow manual initial hourly rates keyed by request flow id, for example{" "}
                              <span className="font-mono text-white/80">{'{"0": 24, "1": 18}'}</span>.
                            </td>
                            <td className="px-3 py-2">
                              <textarea
                                value={initialRateByFlowDraft}
                                onChange={(e) => {
                                  const raw = e.currentTarget.value;
                                  setInitialRateByFlowDraft(raw);
                                  if (raw.trim() === "") {
                                    setInitialRateByFlowError(null);
                                    setSearchParamsOverride((prev) => {
                                      const base: AutomaticRateAdjustmentSearchParams = cloneSearchParams(prev) || {};
                                      delete base.initial_rate_by_flow;
                                      return Object.keys(base).length > 0 ? base : null;
                                    });
                                    return;
                                  }
                                  try {
                                    const parsed = parseInitialRateByFlowInput(raw);
                                    setInitialRateByFlowError(null);
                                    setSearchParamsOverride((prev) => {
                                      const base: AutomaticRateAdjustmentSearchParams = cloneSearchParams(prev) || {};
                                      if (Object.keys(parsed).length > 0) {
                                        base.initial_rate_by_flow = parsed;
                                      } else {
                                        delete base.initial_rate_by_flow;
                                      }
                                      return Object.keys(base).length > 0 ? base : null;
                                    });
                                  } catch (error) {
                                    setInitialRateByFlowError(
                                      error instanceof Error
                                        ? error.message
                                        : "Enter a JSON object keyed by flow id.",
                                    );
                                  }
                                }}
                                placeholder='{"0": 24, "1": 18}'
                                className="min-h-24 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 font-mono text-[12px] text-white"
                                style={{ colorScheme: "dark" }}
                                spellCheck={false}
                              />
                              {initialRateByFlowError ? (
                                <div className="mt-1 text-[11px] text-rose-300">{initialRateByFlowError}</div>
                              ) : (
                                <div className="mt-1 text-[11px] text-white/50">
                                  Leave blank to use the API&apos;s derived initial rates.
                                </div>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Debug toggles */}
            <div className="mt-3 flex items-center gap-3 text-[12px]">
              <button
                onClick={() => setShowDebug((s) => !s)}
                className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15"
              >{showDebug ? 'Hide Requests' : 'Show Requests'}</button>
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
              <div className="mt-2 space-y-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/90 font-mono max-h-72 overflow-auto">
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-white/60">`/base_evaluation` request</div>
                  <pre>{JSON.stringify(evaluationRequestPayload, null, 2)}</pre>
                </div>
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-white/60">`/automatic_rate_adjustment` request</div>
                  <pre>{JSON.stringify(optimizationRequestPayload, null, 2)}</pre>
                </div>
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
              <div className="inline-flex rounded-md shadow-xs overflow-hidden" role="group" aria-label="Toggle view between Demand, Occupancy, Occupancy Flow/Total, and Occupancy Pre-Post">
                <button
                  type="button"
                  aria-pressed={seriesView === 'demand'}
                  onClick={() => setSeriesView('demand')}
                  className={`h-[42px] px-4 text-[12px] font-medium border transition-colors flex items-center justify-center whitespace-nowrap ${
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
                  className={`h-[42px] px-4 text-[12px] font-medium border transition-colors -ml-px flex items-center justify-center whitespace-nowrap ${
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
                  className={`h-[42px] px-4 text-[12px] font-medium border transition-colors -ml-px flex items-center justify-center whitespace-nowrap ${
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
                  className={`h-[42px] px-4 text-[12px] font-medium border transition-colors -ml-px flex items-center justify-center whitespace-nowrap ${
                    seriesView === 'occupancy_all'
                      ? 'bg-blue-500/20 border-blue-400/60 text-white'
                      : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'
                  }`}
                >
                  Occupancy Pre-Post
                </button>
                <button
                  type="button"
                  aria-pressed={seriesView === 'airports_delay'}
                  onClick={() => setSeriesView('airports_delay')}
                  className={`h-[42px] px-4 text-[12px] font-medium border transition-colors -ml-px flex items-center justify-center whitespace-nowrap ${
                    seriesView === 'airports_delay'
                      ? 'bg-blue-500/20 border-blue-400/60 text-white'
                      : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'
                  } rounded-r-md`}
                >
                  Delay Attribution
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 justify-start w-full sm:w-auto">
                {(seriesView === 'demand' || seriesView === 'occupancy') && (
                  <div className="flex items-center gap-2">
                    <select
                      className="h-[42px] px-3 text-[12px] rounded-md bg-white/10 border border-white/20 text-white/90 focus:outline-none"
                      value={rippleSortMode}
                      aria-label="Ripple sort"
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
                  <div className="flex items-center gap-2">
                    <select
                      className="h-[42px] px-3 text-[12px] rounded-md bg-white/10 border border-white/20 text-white/90 focus:outline-none"
                      value={occOrigSortMode}
                      aria-label="Occupancy original sort"
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
                  <div className="flex items-center gap-2">
                    <select
                      className="h-[42px] px-3 text-[12px] rounded-md bg-white/10 border border-white/20 text-white/90 focus:outline-none"
                      value={occAllSortMode}
                      aria-label="Occupancy pre-post sort"
                      onChange={(e) => setOccAllSortMode(e.currentTarget.value as OccupancyPrePostSortMode)}
                    >
                      <option value="total">Rank by Total</option>
                      <option
                        value="abs_change"
                        disabled={!canRankOccAllChanges}
                        title={!canRankOccAllChanges ? 'Run optimization to compare pre and post counts.' : undefined}
                      >
                        Rank by Absolute Changes (Pre vs Post)
                      </option>
                      <option
                        value="relative_change"
                        disabled={!canRankOccAllChanges}
                        title={!canRankOccAllChanges ? 'Run optimization to compare pre and post counts.' : undefined}
                      >
                        Rank by Relative Changes (Pre vs Post)
                      </option>
                      <option
                        value="total_excess_reduced"
                        disabled={!canRankOccAllChanges || !hasOccAllCapacity}
                        title={
                          !canRankOccAllChanges
                            ? 'Run optimization to compare pre and post counts.'
                            : !hasOccAllCapacity
                              ? 'Capacity data is required to rank by total excess reduced.'
                              : undefined
                        }
                      >
                        Total Excess Reduced
                      </option>
                      <option
                        value="total_excess_induced"
                        disabled={!canRankOccAllChanges || !hasOccAllCapacity}
                        title={
                          !canRankOccAllChanges
                            ? 'Run optimization to compare pre and post counts.'
                            : !hasOccAllCapacity
                              ? 'Capacity data is required to rank by total excess induced.'
                              : undefined
                        }
                      >
                        Total Excess Induced
                      </option>
                      <option value="exceedance">By Exceedances</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

          {seriesView !== 'airports_delay' && (
            <GlobalTVBasket contextTvIds={trafficVolumeIds} className="mb-6" />
          )}

          {seriesView === 'airports_delay' && (
            <section className="mb-8">
              <AirportDelayAttributionView
                delays={optState.data?.delays_min || null}
                flights={flights}
                loading={optState.loading}
                error={optState.error}
                perAccAttrib={occAllState.data?.per_acc_attrib || null}
                perAccAttribMode={autoratePerAccAttribMode}
                perAccAttribLoading={autoratePerAccAttribLoading}
                perAccAttribError={autoratePerAccAttribError || occAllState.error}
                onPerAccAttribModeChange={handleRefreshAutoratePerAccAttrib}
              />
            </section>
          )}

          {seriesView === 'occupancy_original' && (
            <section className="mb-8">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-white/60">Per-TV Occupancy Contributions vs Original</div>
                {origCountsState.loading && <ShimmeringText text="Loading..." className="text-xs text-white/70 font-normal" />}
              </div>
              {origCountsState.error && (
                <div className="text-xs text-rose-300 mb-2">{origCountsState.error}</div>
              )}
              {(() => {
                const d = origCountsState.data;
                const unionIds = Array.from(tvUnion);
                if (!d && unionIds.length === 0 && !origCountsState.loading) {
                  return <div className="text-xs text-gray-300">No TVs found in flow occupancy. Run evaluation first.</div>;
                }
                if (!d) return null;
                const minutes = Number(d.time_bin_minutes || minutesPerBin || 15);
                const exceedanceNormalization = minutes > 0 ? minutes / 60 : 1;
                const mismatch = Number.isFinite(d.time_bin_minutes) && d.time_bin_minutes !== minutesPerBin;
                const vFrom = hhmmToMinutesSafe(viewFrom);
                const vTo = hhmmToMinutesSafe(viewTo);
                const counts = d.mentioned_counts || d.counts || {};
                const capacities = d.mentioned_capacity || d.capacity || {};
                const allIds = Array.from(new Set<string>([
                  ...unionIds,
                  ...Object.keys(counts || {}),
                  ...Object.keys(capacities || {}),
                ]));
                const tvIds = applyBasketScope(allIds);
                if (basket.isFiltering && tvIds.length === 0) {
                  return <div className="text-xs text-gray-300">No traffic volumes match the current filter.</div>;
                }

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
                      entry.capacity = normalizeCapacity(capSeries?.[i]);
                    }
                    return entry;
                  });
                  const filtered = rows.filter(r => r.startMin >= vFrom && r.startMin <= vTo);
                  const hasCapacity = capAvail && filtered.some(r => typeof r.capacity === "number");
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
                  return { rows: filtered, flowTotals, hasOverlap, hasCapacity };
                }

                // Determine TV order: controlled first; then by selected metric within view window
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
                      exceed += ex * exceedanceNormalization;
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
                const hiddenCount = Math.max(0, tvIds.length - LIMIT);

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
                        const overloadSegments: TrafficOverloadDatum[] = [];
                        const binMinutes = Math.max(1, minutesPerBin);
                        rows.forEach((row) => {
                          const cap = normalizeCapacity(row.capacity);
                          const occ = Number(row.total);
                          if (cap == null) return;
                          if (!Number.isFinite(occ)) return;
                          const color = resolveHotspotColor({
                            traffic_volume_id: tvId,
                            hourly_occupancy: occ,
                            hourly_capacity: cap,
                          }, hotspotSettings);
                          if (!color) return;
                          const startMinutes = Number(row.startMin ?? 0);
                          if (!Number.isFinite(startMinutes)) return;
                          const endMinutes = startMinutes + binMinutes;
                          const startLabel = formatMinutesToHHMM(startMinutes);
                          const endLabel = formatMinutesToHHMMWith24(endMinutes);
                          overloadSegments.push({
                            period: `${startLabel}-${endLabel}`,
                            color,
                            metadata: [
                              `Total: ${occ.toFixed(0)}`,
                              `Capacity: ${cap.toFixed(0)}`,
                              `Excess: ${(occ - cap).toFixed(0)}`,
                            ],
                            label: `${tvId} overload`,
                          });
                        });
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
                                <TrafficVolumeInfoTooltip
                                  trafficVolumeId={tvId}
                                  className="max-w-[160px] truncate"
                                >
                                  <span className="truncate">{tvId}</span>
                                </TrafficVolumeInfoTooltip>
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
                            <div className="mt-4">
                              <TrafficOverloadBar
                                fromTime={viewFrom}
                                toTime={viewTo}
                                data={overloadSegments}
                                showTime={overloadSegments.length > 0}
                                showOkWhenNoData={false}
                              />
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
                        >{expandedOccOriginal ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenCount)}</button>
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
                postCounts={occAllPostCountsForView}
                preCounts={occAllPreCountsForView}
                capacity={occAllCapacityForView}
                hotspotDiffs={occAllState.data}
                tvOrder={occAllTvOrderForView}
                binMinutes={minutesPerBin}
                viewFrom={viewFrom}
                viewTo={viewTo}
                sortMode={occAllSortMode}
                onSortModeChange={(m) => setOccAllSortMode(m)}
                initialLimit={12}
                loading={occAllState.loading}
                error={occAllState.error}
                showReliefMap
                reliefMapTitle="Traffic Volume Relief Map"
                showGlobalTVBasket={false}
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
          {(seriesView === 'demand' || seriesView === 'occupancy') && (
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
              const candidateRates = normalizeCandidateRates(optFlow?.candidate_rates);
              const rateRangeLabel = resolveGridSearchRangeLabel(optFlow?.candidate_rates, optFlow?.grid_search_range);
              const averageRateStepLabel = formatAverageRateStep(optFlow?.candidate_rates);
              const derivedInitialRateLabel = formatRatePerHour(optFlow?.derived_initial_rate);
              const initialRateLabel = formatRatePerHour(optFlow?.initial_rate);
              const initialRateSourceLabel = (() => {
                const raw = String(optFlow?.initial_rate_source ?? "").trim();
                return raw.length > 0 ? raw.replace(/_/g, " ") : "—";
              })();

              // Sort by total demand descending; ensure controlled TV first for targets
              const sortedTargetTvIds = Object.keys(targets).sort((a, b) => {
                if (controlledTv && a === controlledTv) return -1;
                if (controlledTv && b === controlledTv) return 1;
                const sumA = (targets[a] || []).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
                const sumB = (targets[b] || []).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
                if (sumA !== sumB) return sumB - sumA;
                return a.localeCompare(b);
              });
              const targetTvIds = applyBasketScope(sortedTargetTvIds);
              const rippleScoreByTv = rippleScoreByFlowId.get(Number(flow.flow_id)) || {};
              const sortedRippleTvIds = Object.keys(ripples).sort((a, b) => {
                const sa = Number(rippleScoreByTv[a] ?? 0);
                const sb = Number(rippleScoreByTv[b] ?? 0);
                if (sa !== sb) return sb - sa;
                return a.localeCompare(b);
              });
              const rippleTvIds = applyBasketScope(sortedRippleTvIds);

              if (basket.isFiltering && targetTvIds.length === 0 && rippleTvIds.length === 0) {
                return null;
              }

              return (
                <div key={`flow-${idx}`} className="mb-8">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="text-lg font-semibold text-white">Flow {flow.flow_id} • {numFlights} flights</div>
                    {controlledTv && (
                      <span className="text-[11px] px-2 py-1 rounded-md border border-rose-400/70 bg-rose-500/10 text-rose-200">Controlled volume: {controlledTv}</span>
                    )}
                  </div>
                  {!!optFlow && (
                    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
                      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-white/50">Derived Initial</div>
                        <div className="mt-1 font-mono text-sm text-white">{derivedInitialRateLabel}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-white/50">Initial Rate</div>
                        <div className="mt-1 font-mono text-sm text-white">{initialRateLabel}</div>
                        <div className="mt-1 text-[11px] text-white/55">{initialRateSourceLabel}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-white/50">Tried Range</div>
                        <div className="mt-1 font-mono text-sm text-white">{rateRangeLabel}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-white/50">Avg Step</div>
                        <div className="mt-1 font-mono text-sm text-white">{averageRateStepLabel}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-white/50">Variants</div>
                        <div className="mt-1 font-mono text-sm text-white">{candidateRates.length || "—"}</div>
                      </div>
                    </div>
                  )}

                  {/* Target TV charts */}
                  <div className="mb-4">
                    <div className="text-sm uppercase tracking-wider text-gray-300 mb-2">Targets</div>
                    {targetTvIds.length > 0 ? (
                      <>
                        {(() => {
                          const LIMIT = 6;
                          const showAll = !!expandedTargetCharts[flow.flow_id];
                          const targetList = showAll ? targetTvIds : targetTvIds.slice(0, LIMIT);
                          const hiddenTargetCount = Math.max(0, targetTvIds.length - LIMIT);
                          return (
                            <>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
                                {targetList.map((tvId) => {
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
                                })}
                              </div>
                              {targetTvIds.length > LIMIT && (
                                <div className="mt-2">
                                  <button
                                    onClick={() => setExpandedTargetCharts((prev) => ({ ...prev, [flow.flow_id]: !prev[flow.flow_id] }))}
                                    className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 text-[12px]"
                                  >
                                    {showAll ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenTargetCount)}
                                  </button>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <div className="text-xs text-gray-300">No target demands.</div>
                    )}
                  </div>

                  {/* Ripple TV charts */}
                  {rippleTvIds.length > 0 && (
                    <div>
                      <div className="text-sm uppercase tracking-wider text-gray-300 mb-2">Ripples</div>
                      {(() => {
                        const LIMIT = 12;
                        const showAll = !!expandedRippleCharts[flow.flow_id];
                        const rippleList = showAll ? rippleTvIds : rippleTvIds.slice(0, LIMIT);
                        const hiddenRippleCount = Math.max(0, rippleTvIds.length - LIMIT);
                        return (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
                              {rippleList.map((tvId) => {
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
                              })}
                            </div>
                            {rippleTvIds.length > LIMIT && (
                              <div className="mt-2">
                                <button
                                  onClick={() => setExpandedRippleCharts((prev) => ({ ...prev, [flow.flow_id]: !prev[flow.flow_id] }))}
                                  className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 text-[12px]"
                                >
                                  {showAll ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenRippleCount)}
                                </button>
                              </div>
                            )}
                          </>
                        );
                      })()}
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
        description="Name this snapshot to compare it alongside other optimized runs"
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


type AirportDelayRow = {
  airport: string;
  flightCount: number;
  totalDelay: number;
  averageDelay: number;
  maxDelay: number;
  minDelay: number;
};

type HeaviestDelayInfo = {
  flightId: string;
  callSign: string;
  origin: string;
  destination: string;
  delay: number;
};

type AirportDelayChartRow = {
  airport: string;
  departureDelay: number;
  arrivalDelay: number;
  departureFlights: number;
  arrivalFlights: number;
  total: number;
  totalFlights: number;
};

const toTrimmedString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value == null) {
    return '';
  }
  try {
    return String(value).trim();
  } catch {
    return '';
  }
};

const stringWithFallback = (value: unknown, fallback: string): string => {
  const trimmed = toTrimmedString(value);
  return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeAirportLabel = (value: unknown): string => stringWithFallback(value, 'Unknown');

function AirportDelayAttributionView({
  delays,
  flights,
  loading,
  error,
  perAccAttrib,
  perAccAttribMode,
  perAccAttribLoading,
  perAccAttribError,
  onPerAccAttribModeChange,
}: {
  delays: Record<string, number> | null | undefined;
  flights: Trajectory[];
  loading: boolean;
  error: string | null;
  perAccAttrib: RegulationPlanPerAccAttrib | null | undefined;
  perAccAttribMode: RegulationPlanPerAccAttribMode;
  perAccAttribLoading: boolean;
  perAccAttribError: string | null;
  onPerAccAttribModeChange: (mode: RegulationPlanPerAccAttribMode) => void | Promise<void>;
}) {
  const stats = useMemo<{
    departures: AirportDelayRow[];
    arrivals: AirportDelayRow[];
    totalFlights: number;
    totalDelay: number;
    averageDelay: number;
    heaviest: HeaviestDelayInfo | null;
    combinedEntries: AirportDelayChartRow[];
    uniqueAirports: number;
  } | null>(() => {
    if (!delays) return null;
    const entries = Object.entries(delays);
    if (entries.length === 0) return null;

    const flightsById = buildFlightIdIndex(flights);
    const flightsByCallsign = buildUniqueCallsignIndex(flights);

    type Accumulator = { total: number; count: number; max: number; min: number };
    const depMap = new Map<string, Accumulator>();
    const arrMap = new Map<string, Accumulator>();

    const updateMap = (map: Map<string, Accumulator>, airport: unknown, delay: number) => {
      const key = normalizeAirportLabel(airport);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { total: delay, count: 1, max: delay, min: delay });
      } else {
        existing.total += delay;
        existing.count += 1;
        existing.max = Math.max(existing.max, delay);
        existing.min = Math.min(existing.min, delay);
      }
    };

    let totalDelay = 0;
    let totalFlights = 0;
    let heaviest: HeaviestDelayInfo | null = null;

    for (const [flightKey, rawDelay] of entries) {
      const delay = Number(rawDelay);
      if (!Number.isFinite(delay)) continue;
      totalDelay += delay;
      totalFlights += 1;

      let flight = flightsById.get(String(flightKey));
      if (!flight && flightsByCallsign.has(String(flightKey))) {
        const resolvedId = flightsByCallsign.get(String(flightKey));
        if (resolvedId) {
          flight = flightsById.get(resolvedId);
        }
      }
      const origin = normalizeAirportLabel(flight?.origin);
      const destination = normalizeAirportLabel(flight?.destination);
      const fallbackCallSign = toTrimmedString(flightKey) || 'Unknown';
      const callSign = stringWithFallback(flight?.callSign ?? flightKey, fallbackCallSign);

      updateMap(depMap, origin, delay);
      updateMap(arrMap, destination, delay);

      if (!heaviest || delay > heaviest.delay) {
        heaviest = {
          flightId: String(flightKey),
          callSign,
          origin,
          destination,
          delay,
        };
      }
    }

    if (totalFlights === 0) return null;

    const toRows = (map: Map<string, Accumulator>): AirportDelayRow[] =>
      Array.from(map.entries())
        .map(([airport, stats]) => ({
          airport,
          flightCount: stats.count,
          totalDelay: stats.total,
          averageDelay: stats.total / stats.count,
          maxDelay: stats.max,
          minDelay: stats.min,
        }))
        .sort((a, b) => b.totalDelay - a.totalDelay);

    const departures = toRows(depMap);
    const arrivals = toRows(arrMap);

    const combined = new Map<
      string,
      {
        airport: string;
        departureDelay: number;
        arrivalDelay: number;
        departureFlights: number;
        arrivalFlights: number;
      }
    >();
    const ensureCombined = (airport: string) => {
      const key = airport || 'Unknown';
      let entry = combined.get(key);
      if (!entry) {
        entry = {
          airport: key,
          departureDelay: 0,
          arrivalDelay: 0,
          departureFlights: 0,
          arrivalFlights: 0,
        };
        combined.set(key, entry);
      }
      return entry;
    };

    for (const row of departures) {
      const target = ensureCombined(row.airport);
      target.departureDelay += row.totalDelay;
      target.departureFlights += row.flightCount;
    }
    for (const row of arrivals) {
      const target = ensureCombined(row.airport);
      target.arrivalDelay += row.totalDelay;
      target.arrivalFlights += row.flightCount;
    }

    const combinedEntries: AirportDelayChartRow[] = Array.from(combined.values()).map((entry) => ({
      airport: entry.airport,
      departureDelay: entry.departureDelay,
      arrivalDelay: entry.arrivalDelay,
      departureFlights: entry.departureFlights,
      arrivalFlights: entry.arrivalFlights,
      total: entry.departureDelay + entry.arrivalDelay,
      totalFlights: entry.departureFlights + entry.arrivalFlights,
    }));
    combinedEntries.sort((a, b) => b.total - a.total || a.airport.localeCompare(b.airport));

    return {
      departures,
      arrivals,
      totalFlights,
      totalDelay,
      averageDelay: totalDelay / totalFlights,
      heaviest,
      combinedEntries,
      uniqueAirports: combinedEntries.length,
    };
  }, [delays, flights]);

  const [airportChartMetric, setAirportChartMetric] = useState<'delay' | 'flights'>('delay');
  const chartLimit = 10;
  const chartData = useMemo(() => {
    if (!stats) return [] as AirportDelayChartRow[];
    const entries = stats.combinedEntries.slice();
    entries.sort((a, b) => {
      if (airportChartMetric === 'flights') {
        return b.totalFlights - a.totalFlights || a.airport.localeCompare(b.airport);
      }
      return b.total - a.total || a.airport.localeCompare(b.airport);
    });
    return entries.slice(0, chartLimit);
  }, [stats, airportChartMetric]);
  const chartTotalCount = stats?.combinedEntries.length ?? 0;
  const chartMetricLabel = airportChartMetric === 'delay' ? 'total delay' : 'delayed flights';

  if (!stats) {
    if (loading) {
      return (
        <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-sm text-white/70">
          <ShimmeringText text="Fetching delay data..." />
        </div>
      );
    }
    return (
      <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-sm">
        {error ? (
          <span className="text-rose-300">Failed to load delay data: {error}</span>
        ) : (
          <span className="text-white/70">Run an optimization to generate delay assignments and revisit this view.</span>
        )}
      </div>
    );
  }

  const TABLE_LIMIT = 15;
  const departureRows = stats.departures.slice(0, TABLE_LIMIT);
  const arrivalRows = stats.arrivals.slice(0, TABLE_LIMIT);

  const formatAdaptive = (value: number, fractionDigits = 1) => {
    if (!Number.isFinite(value)) return '—';
    const isInt = Math.abs(value - Math.round(value)) < 1e-6;
    const digits = isInt ? 0 : fractionDigits;
    return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const formatAverage = (value: number) =>
    Number.isFinite(value) ? value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';

  const formatFlights = (value: number) => (Number.isFinite(value) ? Math.round(value).toLocaleString() : '0');

  const heaviest = stats.heaviest;
  const formatChartValue = (value: number) =>
    airportChartMetric === 'delay' ? formatAdaptive(value, 1) : formatFlights(value);
  const tooltipUnit = airportChartMetric === 'delay' ? 'min' : 'flights';
  const barSeries =
    airportChartMetric === 'delay'
      ? [
          { key: 'departureDelay' as const, name: 'Departure delay', color: '#60a5fa' },
          { key: 'arrivalDelay' as const, name: 'Arrival delay', color: '#f472b6' },
        ]
      : [
          { key: 'departureFlights' as const, name: 'Departure flights', color: '#60a5fa' },
          { key: 'arrivalFlights' as const, name: 'Arrival flights', color: '#f472b6' },
        ];
  const chartSummaryText =
    chartTotalCount === 0
      ? 'No airports with delays yet'
      : chartTotalCount > chartData.length
        ? `Top ${chartData.length} of ${chartTotalCount} airports by ${chartMetricLabel}`
        : `Airports by ${chartMetricLabel} (${chartTotalCount})`;

  return (
    <div className="space-y-6">
      {error && !loading && (
        <div className="text-[12px] text-amber-200">
          Latest optimization request error: {error}
        </div>
      )}

      <PerAccDelayAttributionPanel
        perAccAttrib={perAccAttrib}
        mode={perAccAttribMode}
        loading={perAccAttribLoading}
        error={perAccAttribError}
        onModeChange={onPerAccAttribModeChange}
        variant="page"
        unavailableMessage="ACC attribution is unavailable for the current autorate occupancy aggregation response. Use the mode selector to re-fetch attribution."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Flights with delay</div>
          <div className="text-2xl font-semibold text-white">{formatFlights(stats.totalFlights)}</div>
          <div className="text-[12px] text-white/60 mt-1">{stats.uniqueAirports} airports observed</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Average delay per flight</div>
          <div className="text-2xl font-semibold text-white">{formatAverage(stats.averageDelay)} min</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Total delay minutes</div>
          <div className="text-2xl font-semibold text-white">{formatAdaptive(stats.totalDelay, 1)} min</div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Heaviest delay</div>
          <div className="text-2xl font-semibold text-white">
            {heaviest ? `${formatAdaptive(heaviest.delay, 1)} min` : '—'}
          </div>
          {heaviest && (
            <div className="text-[12px] text-white/60 mt-1">
              {heaviest.origin} → {heaviest.destination} ({heaviest.callSign})
            </div>
          )}
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="text-[11px] uppercase tracking-wider text-white/60">Airport delay comparison</div>
          <div className="flex items-center gap-3 text-[11px] text-white/60">
            <select
              aria-label="Select airport delay comparison metric"
              className="h-8 px-3 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 transition-colors text-[12px]"
              value={airportChartMetric}
              onChange={(event) => setAirportChartMetric(event.currentTarget.value as 'delay' | 'flights')}
            >
              <option value="delay">Total delay (min)</option>
              <option value="flights">Delayed flights</option>
            </select>
            <div>{chartSummaryText}</div>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="airport" tick={{ fontSize: 11, fill: '#e2e8f0' }} axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: '#e2e8f0' }}
                tickFormatter={(value: number) => formatChartValue(value)}
                axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                tickLine={false}
                allowDecimals={airportChartMetric === 'delay'}
              />
              <Tooltip
                formatter={(value: number, name: string) => [`${formatChartValue(value)} ${tooltipUnit}`, name]}
                contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: 'white' }}
                itemStyle={{ color: 'white' }}
                labelStyle={{ color: 'white' }}
              />
              <Legend wrapperStyle={{ color: '#f8fafc' }} />
              {barSeries.map((series) => (
                <Bar key={series.key} dataKey={series.key} name={series.name} fill={series.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">Delays by departure airport</div>
          <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
            <table className="w-full text-sm text-white/90">
              <thead className="bg-white/5 text-white/70">
                <tr>
                  <th className="text-left px-3 py-2">Airport</th>
                  <th className="text-right px-3 py-2">Flights</th>
                  <th className="text-right px-3 py-2">Total Delay (min)</th>
                  <th className="text-right px-3 py-2">Avg (min)</th>
                  <th className="text-right px-3 py-2">Max (min)</th>
                  <th className="text-right px-3 py-2">Min (min)</th>
                </tr>
              </thead>
              <tbody>
                {departureRows.map((row, idx) => (
                  <tr
                    key={`dep-${row.airport}-${idx}`}
                    className={`border-t border-white/10 ${idx % 2 === 1 ? 'bg-white/5' : 'bg-white/0'} hover:bg-white/10`}
                  >
                    <td className="px-3 py-2 font-medium text-white">{row.airport}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/90">{formatFlights(row.flightCount)}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.totalDelay, 1)}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/90">{formatAverage(row.averageDelay)}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.maxDelay, 1)}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.minDelay, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stats.departures.length > TABLE_LIMIT && (
            <div className="mt-2 text-[11px] text-white/60">
              Showing top {TABLE_LIMIT} of {stats.departures.length} airports.
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">Delays by arrival airport</div>
          <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
            <table className="w-full text-sm text-white/90">
              <thead className="bg-white/5 text-white/70">
                <tr>
                  <th className="text-left px-3 py-2">Airport</th>
                  <th className="text-right px-3 py-2">Flights</th>
                  <th className="text-right px-3 py-2">Total Delay (min)</th>
                  <th className="text-right px-3 py-2">Avg (min)</th>
                  <th className="text-right px-3 py-2">Max (min)</th>
                  <th className="text-right px-3 py-2">Min (min)</th>
                </tr>
              </thead>
              <tbody>
                {arrivalRows.map((row, idx) => (
                  <tr
                    key={`arr-${row.airport}-${idx}`}
                    className={`border-t border-white/10 ${idx % 2 === 1 ? 'bg-white/5' : 'bg-white/0'} hover:bg-white/10`}
                  >
                    <td className="px-3 py-2 font-medium text-white">{row.airport}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/90">{formatFlights(row.flightCount)}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.totalDelay, 1)}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/90">{formatAverage(row.averageDelay)}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.maxDelay, 1)}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.minDelay, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stats.arrivals.length > TABLE_LIMIT && (
            <div className="mt-2 text-[11px] text-white/60">
              Showing top {TABLE_LIMIT} of {stats.arrivals.length} airports.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Downloads removed per updated design.

function FlowsSummary({ flows, colors, optDelays }: { flows: Record<string, string[]>; colors: Record<string, string>; optDelays?: Record<string, number> | null }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setExpanded((prev) => ({ ...prev, [k]: !prev[k] }));
  const entries = Object.entries(flows || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const { flights } = useSimStore();
  const flightsById = useMemo(() => buildFlightIdIndex(flights), [flights]);
  const flightsByCallsign = useMemo(() => buildUniqueCallsignIndex(flights), [flights]);

  function formatTime(seconds?: number): string {
    if (!Number.isFinite(seconds)) return 'N/A';
    const s = Math.max(0, Math.min(24 * 3600 - 1, Math.floor(seconds as number)));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  function resolveFlight(token: string) {
    const normalized = String(token);
    const byId = flightsById.get(normalized);
    if (byId) return byId;
    if (flightsByCallsign.has(normalized)) {
      const resolvedId = flightsByCallsign.get(normalized);
      if (resolvedId) {
        return flightsById.get(resolvedId);
      }
    }
    return undefined;
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
  }, [flows, optDelays, flightsByCallsign, flightsById]);

  return (
    <div className="space-y-3">
      {extraDelayFlightsWarning && (
        <div className="text-[12px] text-rose-300">{extraDelayFlightsWarning}</div>
      )}
      {entries.map(([fid, ids]) => {
        const list = ids || [];
        const showAll = !!expanded[fid];
        const LIMIT = 25;
        const shown = showAll ? list : list.slice(0, LIMIT);
        const hiddenCount = Math.max(0, list.length - LIMIT);
        const color = colors?.[String(fid)] || '#0f468a';
        const statsFlightIds = list
          .map((token) => {
            const resolved = resolveFlight(String(token));
            return resolved?.flightId ? String(resolved.flightId) : String(token);
          })
          .filter((id) => id && id !== 'undefined' && id !== 'null');
        return (
          <div key={fid} className="text-[12px] text-white/90">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} />
                <span className="font-medium text-sm opacity-90">Flow {fid}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-white/70">
                <span>{list.length} flights</span>
                <FlightStatisticsButton
                  flightIds={statsFlightIds}
                  buttonClassName="border-white/20 text-white/80"
                  ariaLabel={`Open flight statistics for flow ${fid}`}
                  title="Open flight statistics"
                />
                {list.length > 25 && (
                  <button onClick={() => toggle(fid)} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[11px] text-white/80 hover:bg-white/15">
                    {showAll ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenCount)}
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
          <TrafficVolumeInfoTooltip trafficVolumeId={tvId} className="max-w-[160px] truncate">
            <span className="truncate">{tvId}</span>
          </TrafficVolumeInfoTooltip>
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

function formatMinutesToHHMM(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "00:00";
  const minutesInDay = 24 * 60;
  const normalized = ((Math.floor(totalMinutes) % minutesInDay) + minutesInDay) % minutesInDay;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatMinutesToHHMMWith24(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "00:00";
  const minutesInDay = 24 * 60;
  if (totalMinutes >= minutesInDay) {
    return "24:00";
  }
  if (totalMinutes < 0) {
    return formatMinutesToHHMM(0);
  }
  return formatMinutesToHHMM(totalMinutes);
}
