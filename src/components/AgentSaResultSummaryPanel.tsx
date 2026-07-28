'use client';

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import OccupancyPrePostPanel, {
  type OccupancyPrePostSortMode,
} from '@/components/OccupancyPrePostPanel';
import OdDelayAttributionPanel from '@/components/OdDelayAttributionPanel';
import PerAccDelayAttributionPanel from '@/components/PerAccDelayAttributionPanel';
import ShimmeringText from '@/components/ShimmeringText';
import TimeScaleControl from '@/components/TimeScaleControl';
import TrafficVolumeReliefMap from '@/components/TrafficVolumeReliefMap';
import { useSimStore } from '@/components/useSimStore';
import { authFetch } from '@/lib/auth';
import type {
  SaObjectiveHistorySeries,
  SaPosthocAnalysisResponse,
  SaPosthocOccupancyPrePost,
  SaPosthocOccupancyResponse,
  SaTvReliefWindow,
} from '@/lib/agentSaTypes';
import { toSaPerAccAttrib } from '@/lib/agentSaTypes';
import type { AgentRunRef } from '@/lib/agentRuns';
import type { Trajectory } from '@/lib/models';

type ObjectiveViewMode = 'total' | 'components';

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatMetric(value: unknown, fractionDigits = 1): string {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return '—';
  const abs = Math.abs(numeric);
  const digits =
    abs >= 100 ? 0 : Math.abs(numeric - Math.round(numeric)) < 1e-6 ? 0 : fractionDigits;
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatImprovement(value: unknown): string {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return '—';
  const formatted = formatMetric(numeric, 1);
  return numeric >= 0 ? `+${formatted}` : formatted;
}

function formatTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  if (Math.abs(value) >= 100) {
    return Math.round(value).toString();
  }
  const rounded = Number(value.toFixed(1));
  return rounded.toString();
}

function pickString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function minutesToHHmm(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.floor(totalMinutes)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseRangeLabel(
  labels: string[] | undefined,
): { from: string; to: string } | null {
  if (!Array.isArray(labels) || labels.length === 0) return null;
  const first = labels[0]?.split('-')?.[0]?.trim();
  const lastParts = labels[labels.length - 1]?.split('-').map((part) => part.trim());
  const last = lastParts?.[lastParts.length - 1];
  if (!first || !last) return null;
  return {
    from: first.slice(0, 5),
    to: last.slice(0, 5) === '24:00' ? '23:59' : last.slice(0, 5),
  };
}

function deriveOccupancyViewRange(
  prePost: SaPosthocOccupancyPrePost | null | undefined,
): { from: string; to: string } {
  const labels = prePost?.timebins?.labels;
  const fromLabels = parseRangeLabel(labels);
  if (fromLabels) return fromLabels;

  const binMinutes = Number(prePost?.time_bin_minutes) || 15;
  const numBins = Number(prePost?.num_bins);
  if (Number.isFinite(numBins) && numBins > 0) {
    return {
      from: '00:00',
      to: minutesToHHmm(numBins * binMinutes - 1),
    };
  }

  return {
    from: '00:00',
    to: '23:59',
  };
}

function buildObjectiveChartData(
  analysis: SaPosthocAnalysisResponse | null,
): Array<{
  iteration: number;
  total: number | null;
  capacity: number | null;
  delay: number | null;
}> {
  const history = analysis?.objective_history;
  const iterations = Array.isArray(history?.iterations) ? history.iterations : [];
  const totals = Array.isArray(history?.total_improvement) ? history.total_improvement : [];
  const capacities = Array.isArray(history?.capacity_component_delta)
    ? history.capacity_component_delta
    : [];
  const delays = Array.isArray(history?.delay_component_delta)
    ? history.delay_component_delta
    : [];

  return iterations.map((iteration, index) => ({
    iteration: Number(iteration),
    total: toFiniteNumber(totals[index]),
    capacity: toFiniteNumber(capacities[index]),
    delay: toFiniteNumber(delays[index]),
  }));
}

interface SaFlightRowData {
  flightId: string;
  callsign: string;
  origin: string;
  destination: string;
  delayMinutes: number;
}

function buildSaFlightRows(
  analysis: SaPosthocAnalysisResponse | null,
  flightsById: Map<string, Trajectory>,
): SaFlightRowData[] {
  const delays = analysis?.best_solution?.delays_by_flight;
  if (!delays || typeof delays !== 'object') return [];

  const bestSolution = analysis?.best_solution as Record<string, unknown> | undefined;
  const flightMetadataByFlightRaw =
    bestSolution?.flight_metadata_by_flight ??
    bestSolution?.flight_metadata ??
    bestSolution?.metadata_by_flight;
  const flightMetadataByFlight =
    flightMetadataByFlightRaw &&
    typeof flightMetadataByFlightRaw === 'object' &&
    !Array.isArray(flightMetadataByFlightRaw)
      ? (flightMetadataByFlightRaw as Record<string, unknown>)
      : undefined;

  const rows: SaFlightRowData[] = [];
  for (const [flightIdRaw, delayRaw] of Object.entries(delays)) {
    const flightId = String(flightIdRaw).trim();
    if (!flightId) continue;

    const delayMinutes = toFiniteNumber(delayRaw);
    if (delayMinutes === null) continue;

    const sim = flightsById.get(flightId);
    const flightMetadataRaw = flightMetadataByFlight?.[flightId];
    const flightMetadata =
      flightMetadataRaw &&
      typeof flightMetadataRaw === 'object' &&
      !Array.isArray(flightMetadataRaw)
        ? (flightMetadataRaw as Record<string, unknown>)
        : undefined;

    rows.push({
      flightId,
      callsign:
        pickString([
          flightMetadata?.callsign,
          flightMetadata?.call_sign,
          sim?.callSign,
          sim?.flightId,
          flightId,
        ]) ?? flightId,
      origin: pickString([flightMetadata?.origin, flightMetadata?.origin_aerodrome, sim?.origin]) ?? '—',
      destination:
        pickString([
          flightMetadata?.destination,
          flightMetadata?.destination_aerodrome,
          sim?.destination,
        ]) ?? '—',
      delayMinutes,
    });
  }

  rows.sort((a, b) => {
    if (Math.abs(b.delayMinutes - a.delayMinutes) > 0.001) {
      return b.delayMinutes - a.delayMinutes;
    }
    const callsignOrder = a.callsign.localeCompare(b.callsign, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (callsignOrder !== 0) return callsignOrder;
    return a.flightId.localeCompare(b.flightId, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  return rows;
}

function objectiveTooltip({
  active,
  payload,
  label,
}: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/90 px-3 py-2 text-xs text-white shadow-lg">
      <div className="font-medium text-white/90">Iteration {label}</div>
      <div className="mt-1 space-y-1">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-3">
            <span style={{ color: entry.color }}>{entry.name}</span>
            <span className="font-mono text-white/85">{formatMetric(entry.value, 2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface AgentSaResultSummaryPanelProps {
  className?: string;
  flightsPaneOpen?: boolean;
  leadingContent?: ReactNode;
  mode?: 'sa' | 'ga';
  onFlightsPaneOpenChange?: (open: boolean) => void;
  selectedPointId?: string | null;
  run: AgentRunRef;
}

export default function AgentSaResultSummaryPanel({
  className = '',
  flightsPaneOpen = true,
  leadingContent,
  mode = 'sa',
  onFlightsPaneOpenChange,
  selectedPointId,
  run,
}: AgentSaResultSummaryPanelProps) {
  const isGa = mode === 'ga';
  const commitTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [selectedSeries, setSelectedSeries] = useState<SaObjectiveHistorySeries>('best');
  const [objectiveView, setObjectiveView] = useState<ObjectiveViewMode>('total');
  const [analysisData, setAnalysisData] = useState<SaPosthocAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(true);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [occupancyData, setOccupancyData] = useState<SaPosthocOccupancyResponse | null>(null);
  const [occupancyLoading, setOccupancyLoading] = useState<boolean>(true);
  const [occupancyError, setOccupancyError] = useState<string | null>(null);
  const [selectedWindowLabel, setSelectedWindowLabel] = useState<string | null>(null);
  const [viewFrom, setViewFrom] = useState<string>('00:00');
  const [viewTo, setViewTo] = useState<string>('23:59');
  const [occSortMode, setOccSortMode] = useState<OccupancyPrePostSortMode>('abs_change');
  const flights = useSimStore((state) => state.flights);
  const deferredOccSortMode = useDeferredValue(occSortMode);
  const deferredViewFrom = useDeferredValue(viewFrom);
  const deferredViewTo = useDeferredValue(viewTo);

  useEffect(() => {
    setSelectedSeries('best');
    setObjectiveView('total');
  }, [run.runKey]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function fetchAnalysis() {
      try {
        setAnalysisLoading(true);
        setAnalysisError(null);
        const params = new URLSearchParams({ run_id: run.runId });
        if (isGa) {
          if (selectedPointId) params.set('point_id', selectedPointId);
        } else {
          params.set('series', selectedSeries);
        }
        const endpoint = isGa ? '/api/ga_posthoc_analysis' : '/api/sa_posthoc_analysis';
        const response = await authFetch(`${endpoint}?${params.toString()}`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(
            text || `Failed to fetch ${isGa ? 'GA' : 'SA'} analysis (${response.status})`,
          );
        }

        const payload = (await response.json()) as SaPosthocAnalysisResponse;
        if (cancelled) return;
        setAnalysisData(payload);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setAnalysisError(
          err instanceof Error ? err.message : `Failed to fetch ${isGa ? 'GA' : 'SA'} analysis`,
        );
        setAnalysisData(null);
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    }

    fetchAnalysis();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isGa, run.runId, run.runKey, selectedPointId, selectedSeries]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function fetchOccupancy() {
      try {
        setOccupancyLoading(true);
        setOccupancyError(null);
        const params = new URLSearchParams({ run_id: run.runId });
        if (isGa && selectedPointId) params.set('point_id', selectedPointId);
        const endpoint = isGa ? '/api/ga_posthoc_occupancy' : '/api/sa_posthoc_occupancy';
        const response = await authFetch(`${endpoint}?${params.toString()}`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(
            text || `Failed to fetch ${isGa ? 'GA' : 'SA'} occupancy (${response.status})`,
          );
        }

        const payload = (await response.json()) as SaPosthocOccupancyResponse;
        if (cancelled) return;
        setOccupancyData(payload);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setOccupancyError(
          err instanceof Error ? err.message : `Failed to fetch ${isGa ? 'GA' : 'SA'} occupancy`,
        );
        setOccupancyData(null);
      } finally {
        if (!cancelled) setOccupancyLoading(false);
      }
    }

    fetchOccupancy();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isGa, run.runId, run.runKey, selectedPointId]);

  useEffect(() => {
    const range = deriveOccupancyViewRange(occupancyData?.pre_post);
    setViewFrom(range.from);
    setViewTo(range.to);
  }, [occupancyData?.pre_post]);

  useEffect(() => {
    const windows = analysisData?.tv_relief?.windows ?? [];
    if (!windows.length) {
      setSelectedWindowLabel(null);
      return;
    }
    setSelectedWindowLabel((current) => {
      if (current && windows.some((window) => window.label === current)) {
        return current;
      }
      return windows[0]?.label ?? null;
    });
  }, [analysisData?.tv_relief?.windows]);

  const objectiveChartData = useMemo(
    () => buildObjectiveChartData(analysisData),
    [analysisData],
  );
  const flightsById = useMemo(() => {
    const map = new Map<string, Trajectory>();
    for (const flight of flights) {
      map.set(String(flight.flightId), flight);
    }
    return map;
  }, [flights]);
  const delayRows = useMemo(
    () => buildSaFlightRows(analysisData, flightsById),
    [analysisData, flightsById],
  );
  const delayedRowsCount = useMemo(
    () => delayRows.filter((row) => row.delayMinutes > 0).length,
    [delayRows],
  );

  const selectedWindow = useMemo<SaTvReliefWindow | null>(() => {
    const windows = analysisData?.tv_relief?.windows ?? [];
    if (!selectedWindowLabel) return windows[0] ?? null;
    return windows.find((window) => window.label === selectedWindowLabel) ?? windows[0] ?? null;
  }, [analysisData?.tv_relief?.windows, selectedWindowLabel]);

  const selectedWindowMap = useMemo(() => {
    if (!selectedWindow) return {};
    return analysisData?.tv_relief?.absolute_maps?.[selectedWindow.label] ?? {};
  }, [analysisData?.tv_relief?.absolute_maps, selectedWindow]);

  const canRankOccAllChanges = useMemo(() => {
    const pre = occupancyData?.pre_post?.pre_counts || {};
    const post = occupancyData?.pre_post?.post_counts || {};
    const hasPre = Object.values(pre).some(
      (series) => Array.isArray(series) && (series as unknown[]).length > 0,
    );
    const hasPost = Object.values(post).some(
      (series) => Array.isArray(series) && (series as unknown[]).length > 0,
    );
    return hasPre && hasPost;
  }, [occupancyData?.pre_post?.pre_counts, occupancyData?.pre_post?.post_counts]);

  const hasOccCapacity = useMemo(() => {
    const capacity = occupancyData?.pre_post?.capacity || {};
    return Object.values(capacity).some(
      (series) => Array.isArray(series) && (series as unknown[]).length > 0,
    );
  }, [occupancyData?.pre_post?.capacity]);

  const status = String(
    analysisData?.metadata?.status ??
      occupancyData?.metadata?.status ??
      'unknown',
  );
  const lastUpdated = formatTimestamp(analysisData?.metadata?.generated_at);
  const occupancyBinMinutes = Number(occupancyData?.pre_post?.time_bin_minutes) || 15;
  const accAttrib = useMemo(
    () => toSaPerAccAttrib(analysisData?.acc_attributed_delay_full_day),
    [analysisData?.acc_attributed_delay_full_day],
  );
  const selectedPoint = analysisData?.metadata?.selected_point as
    | Record<string, unknown>
    | undefined;

  const objectiveSection = (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-5 shadow-[0_10px_32px_-20px_rgba(168,85,247,0.62)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white/90">Objective Progress</h3>
          <p className="text-xs text-white/60">
            {isGa
              ? 'Track the knee solution as the Pareto population evolves over generations.'
              : 'Inspect optimization progress over iterations for the selected SA trace.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isGa && <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
            {(['best', 'current'] as SaObjectiveHistorySeries[]).map((series) => (
              <button
                key={series}
                type="button"
                onClick={() => setSelectedSeries(series)}
                className={`rounded-full px-3 py-1.5 text-xs transition ${
                  selectedSeries === series
                    ? 'bg-sky-500/20 text-sky-100'
                    : 'text-white/65 hover:bg-white/10 hover:text-white'
                }`}
              >
                {series === 'best' ? 'Best' : 'Current'}
              </button>
            ))}
          </div>}
          <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
            {(['total', 'components'] as ObjectiveViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setObjectiveView(mode)}
                className={`rounded-full px-3 py-1.5 text-xs transition ${
                  objectiveView === mode
                    ? 'bg-emerald-500/20 text-emerald-100'
                    : 'text-white/65 hover:bg-white/10 hover:text-white'
                }`}
              >
                {mode === 'total' ? 'Total' : 'Components'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 h-[320px] rounded-xl border border-white/10 bg-slate-950/60 p-3">
        {analysisLoading ? (
          <div className="flex h-full items-center justify-center">
            <ShimmeringText text="Loading objective history..." className="text-sm text-white/60 font-normal" />
          </div>
        ) : analysisError ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {analysisError}
          </div>
        ) : objectiveChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={objectiveChartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis
                dataKey="iteration"
                tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                tickLine={false}
                tickFormatter={(value: number) => formatMetric(value, 0)}
              />
              <Tooltip content={objectiveTooltip} />
              {objectiveView === 'total' ? (
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total improvement"
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ) : (
                <>
                  <Line
                    type="monotone"
                    dataKey="capacity"
                    name="Capacity delta"
                    stroke="#22c55e"
                    strokeWidth={2.25}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="delay"
                    name="Delay delta"
                    stroke="#f59e0b"
                    strokeWidth={2.25}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    isAnimationActive={false}
                    connectNulls
                  />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/60">
            No objective history available for this run.
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <section className={`agent-result-summary__details-pane flex min-w-0 flex-col overflow-y-auto no-scrollbar ${className}`}>
        <div className="space-y-6 px-6 py-6">
        {leadingContent}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_40px_-24px_rgba(168,85,247,0.68)] backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-fuchsia-400/35 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fuchsia-100">
                  {isGa ? 'GA' : 'SA'}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-wide text-white/70">
                  {status.replace(/[_-]+/g, ' ')}
                </span>
              </div>
              <h2 className="mt-3 text-xl font-semibold text-white/90">
                {isGa ? 'NSGA-II Selected Solution' : 'Simulated Annealing Summary'}
              </h2>
              <p className="mt-1 text-sm text-white/60">
                Run {run.runId}
                {lastUpdated ? ` · Updated ${lastUpdated}` : ''}
              </p>
            </div>
            {(analysisLoading || occupancyLoading) && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                Refreshing…
              </span>
            )}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-wide text-white/45">
                {isGa ? 'Combined Improvement' : 'Total Improvement'}
              </div>
              <div className="mt-2 text-2xl font-semibold text-emerald-300">
                {formatImprovement(analysisData?.summary_metrics?.final_total_objective_improvement)}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-wide text-white/45">
                {isGa ? 'Capacity Relief' : 'Capacity Delta'}
              </div>
              <div className="mt-2 text-2xl font-semibold text-sky-200">
                {formatMetric(analysisData?.summary_metrics?.final_capacity_excess_delta, 1)}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-wide text-white/45">
                {isGa ? 'Delay Cost' : 'Delay Delta'}
              </div>
              <div className="mt-2 text-2xl font-semibold text-amber-200">
                {formatMetric(
                  isGa
                    ? analysisData?.summary_metrics?.total_delay_min
                    : analysisData?.summary_metrics?.final_delay_component_delta,
                  1,
                )}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-wide text-white/45">Delayed Flights</div>
              <div className="mt-2 text-2xl font-semibold text-white/90">
                {formatMetric(analysisData?.summary_metrics?.num_delayed_flights, 0)}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-wide text-white/45">Total Delay</div>
              <div className="mt-2 text-2xl font-semibold text-white/90">
                {formatMetric(analysisData?.summary_metrics?.total_delay_min, 1)} min
              </div>
              <div className="mt-1 text-xs text-white/55">
                avg {formatMetric(analysisData?.summary_metrics?.average_delay_min, 1)} min
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.85fr)]">
            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-wide text-white/45">
                {isGa ? 'Selected Pareto Solution' : 'Best Solution'}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-[11px] text-white/45">J_total</div>
                  <div className="text-sm font-semibold text-white/90">
                    {formatMetric(analysisData?.best_solution?.objectives?.J_total, 1)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-white/45">J_cap</div>
                  <div className="text-sm font-semibold text-white/90">
                    {formatMetric(analysisData?.best_solution?.objectives?.J_cap, 1)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-white/45">J_delay</div>
                  <div className="text-sm font-semibold text-white/90">
                    {formatMetric(analysisData?.best_solution?.objectives?.J_delay, 1)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-white/45">Delay</div>
                  <div className="text-sm font-semibold text-white/90">
                    {formatMetric(analysisData?.best_solution?.total_delay_min, 1)} min
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-wide text-white/45">
                {isGa ? 'Pareto Selection' : 'Convergence Fit'}
              </div>
              <div className="mt-3 space-y-2 text-sm text-white/75">
                {isGa ? (
                  <>
                    <div>
                      <span className="text-white/45">Point:</span>{' '}
                      <span className="font-medium text-white/90">
                        {String(selectedPoint?.point_id ?? selectedPointId ?? '—')}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/45">Frontier index:</span>{' '}
                      <span className="font-medium text-white/90">
                        {formatMetric(selectedPoint?.frontier_index, 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/45">Knee solution:</span>{' '}
                      <span className="font-medium text-white/90">
                        {selectedPoint?.is_knee ? 'Yes' : 'No'}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="text-white/45">Model:</span>{' '}
                      <span className="font-medium text-white/90">
                        {analysisData?.convergence_fit?.model ?? '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/45">Asymptote:</span>{' '}
                      <span className="font-medium text-white/90">
                        {formatMetric(analysisData?.convergence_fit?.asymptote_improvement, 2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/45">Rate:</span>{' '}
                      <span className="font-medium text-white/90">
                        {formatMetric(analysisData?.convergence_fit?.rate_constant, 4)}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/45">R²:</span>{' '}
                      <span className="font-medium text-white/90">
                        {formatMetric(analysisData?.convergence_fit?.r_squared, 3)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          {objectiveSection}
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_32px_-20px_rgba(168,85,247,0.7)] backdrop-blur-sm">
              <PerAccDelayAttributionPanel
                perAccAttrib={accAttrib}
                mode="dwelling_spread"
                loading={analysisLoading}
                error={analysisError}
                onModeChange={() => undefined}
                allowModeChange={false}
                metricsGridClassName="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                variant="page"
                unavailableMessage={`ACC attribution is unavailable for this ${isGa ? 'GA' : 'SA'} analysis payload.`}
              />
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_32px_-20px_rgba(147,51,234,0.62)] backdrop-blur-sm">
              <OdDelayAttributionPanel
                odAttributedDelay={analysisData?.od_attributed_delay_full_day}
                loading={analysisLoading}
                error={analysisError}
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_32px_-20px_rgba(139,92,246,0.68)] backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white/90">Traffic Volume Relief</h3>
              <p className="text-xs text-white/60">
                Histogram-based TV dynamics for the selected analysis window.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(analysisData?.tv_relief?.windows ?? []).map((window) => (
                <button
                  key={window.label}
                  type="button"
                  onClick={() => setSelectedWindowLabel(window.label)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    selectedWindow?.label === window.label
                      ? 'border-sky-400/60 bg-sky-500/20 text-sky-100'
                      : 'border-white/10 bg-white/5 text-white/65 hover:border-white/20 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {window.display_label ?? window.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              {analysisLoading && !analysisData?.tv_relief ? (
                <div className="flex h-[320px] items-center justify-center">
                  <ShimmeringText text="Loading relief map..." className="text-sm text-white/60 font-normal" />
                </div>
              ) : analysisError && !analysisData?.tv_relief ? (
                <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {analysisError}
                </div>
              ) : (
                <TrafficVolumeReliefMap
                  deltasByTv={selectedWindowMap}
                  loading={analysisLoading}
                  colorMode="absolute"
                  valueLabel="TV metrics"
                  negativeLegendLabel="Lower dynamics"
                  positiveLegendLabel="Higher dynamics"
                  emptyMessage="No TV dynamics available for this analysis window."
                />
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="text-[11px] uppercase tracking-wide text-white/45">Selected Window</div>
              <div className="mt-3 text-lg font-semibold text-white/90">
                {selectedWindow?.display_label ?? selectedWindow?.label ?? '—'}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div>
                  <div className="text-[11px] text-white/45">Total absolute dynamics</div>
                  <div className="text-sm font-semibold text-white/90">
                    {formatMetric(selectedWindow?.total_absolute_dynamics, 2)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-white/45">Peak TV</div>
                  <div className="text-sm font-semibold text-white/90">
                    {selectedWindow?.max_tv_id ?? '—'}
                  </div>
                  <div className="text-xs text-white/55">
                    {formatMetric(selectedWindow?.max_tv_value, 2)}
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <div className="text-[11px] uppercase tracking-wide text-white/45">Top TVs</div>
                <div className="mt-3 space-y-2">
                  {(selectedWindow?.top_tvs ?? []).slice(0, 5).map((tv) => (
                    <div
                      key={`${selectedWindow?.label}-${tv.traffic_volume_id}`}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-white/85">{tv.traffic_volume_id}</span>
                        <span className="text-sm font-semibold text-sky-200">
                          {formatMetric(tv.absolute_dynamics, 2)}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-white/55">
                        net {formatImprovement(tv.signed_net_change)} · {formatMetric(tv.changed_bins, 0)} changed bins
                      </div>
                    </div>
                  ))}
                  {selectedWindow?.top_tvs?.length ? null : (
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60">
                      No highlighted traffic volumes for this window.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_32px_-20px_rgba(124,58,237,0.58)] backdrop-blur-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white/90">Occupancy Pre/Post Histograms</h3>
              <p className="text-xs text-white/60">
                Compare the selected {isGa ? 'GA Pareto' : 'SA'} solution against the baseline occupancy counts.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-white/55">
              <span>{formatMetric(occupancyData?.summary?.changed_tv_count, 0)} changed TVs</span>
              <span>{formatMetric(occupancyData?.summary?.total_delayed_flights, 0)} delayed flights</span>
              <span>{occupancyBinMinutes} min bins</span>
            </div>
          </div>

	          <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
	            <div className="mb-4 grid items-end gap-3 lg:grid-cols-[minmax(280px,1fr)_auto_auto]">
	              <div>
	                <div className="mb-2 text-[11px] uppercase tracking-wide text-white/45">Visible Time Range</div>
	                <TimeScaleControl
	                  time_from={viewFrom}
	                  time_to={viewTo}
	                  stepMinutes={occupancyBinMinutes}
	                  onCommit={(from, to) => {
	                    clearTimeout(commitTimeout.current);
	                    commitTimeout.current = setTimeout(() => {
	                      setViewFrom(from);
	                      setViewTo(to);
	                    }, 150);
	                  }}
	                />
	              </div>
	              <div className="flex items-center justify-start gap-2 lg:justify-end">
	                <select
	                  className="h-[40px] rounded-md border border-white/20 bg-white/10 px-3 text-[12px] text-white/90 focus:outline-none"
	                  value={occSortMode}
	                  aria-label={`${isGa ? 'GA' : 'SA'} occupancy histogram sort`}
	                  onChange={(e) =>
	                    setOccSortMode(e.currentTarget.value as OccupancyPrePostSortMode)
	                  }
	                >
	                  <option value="total">Rank by Total</option>
	                  <option
	                    value="abs_change"
	                    disabled={!canRankOccAllChanges}
	                    title={!canRankOccAllChanges ? 'Pre and post counts required to rank by changes.' : undefined}
	                  >
	                    Rank by Absolute Changes
	                  </option>
	                  <option
	                    value="relative_change"
	                    disabled={!canRankOccAllChanges}
	                    title={!canRankOccAllChanges ? 'Pre and post counts required to rank by changes.' : undefined}
	                  >
	                    Rank by Relative Changes
	                  </option>
	                  <option
	                    value="total_excess_reduced"
	                    disabled={!canRankOccAllChanges || !hasOccCapacity}
	                    title={
	                      !canRankOccAllChanges
	                        ? 'Pre and post counts required to rank by changes.'
	                        : !hasOccCapacity
	                          ? 'Capacity data required to rank by total excess reduced.'
	                          : undefined
	                    }
	                  >
	                    Total Excess Reduced
	                  </option>
	                  <option
	                    value="total_excess_induced"
	                    disabled={!canRankOccAllChanges || !hasOccCapacity}
	                    title={
	                      !canRankOccAllChanges
	                        ? 'Pre and post counts required to rank by changes.'
	                        : !hasOccCapacity
	                          ? 'Capacity data required to rank by total excess induced.'
	                          : undefined
	                    }
	                  >
	                    Total Excess Induced
	                  </option>
	                  <option
	                    value="exceedance"
	                    disabled={!hasOccCapacity}
	                    title={!hasOccCapacity ? 'Capacity data required to rank by exceedance.' : undefined}
	                  >
	                    By Exceedances
	                  </option>
	                </select>
	              </div>
	              <div className="text-xs text-white/55">
	                View {viewFrom} → {viewTo}
	              </div>
	            </div>
	            {occupancyError && !occupancyData?.pre_post ? (
	              <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
	                {occupancyError}
	              </div>
	            ) : (
	              <OccupancyPrePostPanel
	                postCounts={occupancyData?.pre_post?.post_counts ?? {}}
	                preCounts={occupancyData?.pre_post?.pre_counts ?? {}}
	                capacity={occupancyData?.pre_post?.capacity ?? undefined}
	                hotspotDiffs={occupancyData?.pre_post ?? null}
	                tvOrder={occupancyData?.pre_post?.tv_ids_order ?? undefined}
	                binMinutes={occupancyBinMinutes}
	                viewFrom={deferredViewFrom}
	                viewTo={deferredViewTo}
	                sortMode={deferredOccSortMode}
	                onSortModeChange={setOccSortMode}
	                loading={occupancyLoading}
	                error={occupancyError}
	                showReliefMap={false}
	                compact
	                showLabels={false}
	              />
	            )}
	          </div>
        </div>
        </div>
      </section>
      <aside className="agent-result-summary__flights-pane relative flex min-w-0 flex-col overflow-hidden border-l border-white/5">
        {!flightsPaneOpen ? (
          <button
            type="button"
            onClick={() => onFlightsPaneOpenChange?.(true)}
            className="group flex h-full w-full flex-col items-center gap-3 bg-white/[0.02] py-4 text-white/55 transition hover:bg-white/[0.06] hover:text-white/90"
            aria-label={`Show flight assignments (${delayRows.length} flights)`}
            title="Show flight assignments"
          >
            <ChevronRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5" strokeWidth={1.8} />
            <span className="rounded-full bg-white/10 px-1.5 py-1 text-[10px] font-semibold text-white/75">
              {delayRows.length}
            </span>
            <span className="mt-4 rotate-90 whitespace-nowrap text-xs font-medium text-white/65">
              Flights
            </span>
          </button>
        ) : (
          <>
        <div className="border-b border-white/10 px-4 py-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white/85">Flights (Whole Plan)</h3>
              <p className="text-xs text-white/55">
                Concrete delay assignment for each flight from the selected {isGa ? 'GA Pareto' : 'SA final'} solution
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="shrink-0 whitespace-nowrap text-right text-[11px] uppercase tracking-wide text-white/45">
                <div>{delayRows.length} flights</div>
                <div>{delayedRowsCount} delayed</div>
              </div>
              <button
                type="button"
                onClick={() => onFlightsPaneOpenChange?.(false)}
                className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/55 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                aria-label="Collapse flight assignments"
                title="Collapse flight assignments"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4">
          {analysisLoading && delayRows.length === 0 ? (
            <div className="flex h-full justify-center">
              <ShimmeringText
                text="Loading flights…"
                className="text-sm text-white/60 font-normal"
              />
            </div>
          ) : analysisError && delayRows.length === 0 ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {analysisError}
            </div>
          ) : delayRows.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_12px_30px_-20px_rgba(8,145,178,0.6)]">
              <table className="w-full table-fixed text-xs text-white/80">
                <thead>
                  <tr className="bg-white/10 text-[11px] uppercase tracking-wide text-white/55">
                    <th className="w-10 px-3 py-2 text-center">✓</th>
                    <th className="w-24 px-3 py-2 text-left">Callsign</th>
                    <th className="w-16 px-3 py-2 text-left">Origin</th>
                    <th className="w-16 px-3 py-2 text-left">Dest</th>
                    <th className="px-3 py-2 text-right">Delay (min)</th>
                  </tr>
                </thead>
                <tbody>
                  {delayRows.map((row, index) => {
                    const isDelayed = row.delayMinutes > 0;
                    return (
                      <tr
                        key={row.flightId}
                        className={`border-t border-white/10 text-sm transition ${
                          index % 2 === 0 ? 'bg-white/5 hover:bg-white/10' : 'bg-white/10 hover:bg-white/15'
                        }`}
                      >
                        <td className="px-3 py-2 text-center text-sm font-semibold text-white/90">
                          {isDelayed ? '✓' : ''}
                        </td>
                        <td className="px-3 py-2 font-mono text-sm text-white">
                          {row.callsign}
                        </td>
                        <td className="px-3 py-2 text-sm">{row.origin}</td>
                        <td className="px-3 py-2 text-sm">{row.destination}</td>
                        <td className="px-3 py-2 text-right font-mono text-sm">
                          {formatMinutes(row.delayMinutes)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-white/60">
              No delay assignments available for this {isGa ? 'GA' : 'SA'} run.
            </div>
          )}
        </div>
          </>
        )}
      </aside>
    </>
  );
}
