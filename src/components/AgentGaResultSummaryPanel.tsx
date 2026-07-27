'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import AgentSaResultSummaryPanel from '@/components/AgentSaResultSummaryPanel';
import ShimmeringText from '@/components/ShimmeringText';
import { authFetch } from '@/lib/auth';
import type {
  GaParetoFrontierResponse,
  GaParetoPoint,
} from '@/lib/agentGaTypes';
import type { AgentRunRef } from '@/lib/agentRuns';

interface AgentGaResultSummaryPanelProps {
  flightsPaneOpen?: boolean;
  onFlightsPaneOpenChange?: (open: boolean) => void;
  run: AgentRunRef;
}

function formatNumber(value: unknown, digits = 0): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function ParetoTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: GaParetoPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/95 px-4 py-3 text-xs text-white shadow-xl">
      <div className="flex items-center gap-2 font-semibold text-white/90">
        Point {point.point_id}
        {point.is_knee ? (
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] uppercase text-amber-200">
            Knee
          </span>
        ) : null}
      </div>
      <div className="mt-2 space-y-1 text-white/65">
        <div>Capacity relief: {formatNumber(point.capacity_improvement, 1)}</div>
        <div>Total delay: {formatNumber(point.delay_minutes, 1)} min</div>
        <div>Delayed flights: {formatNumber(point.num_delayed_flights)}</div>
        <div>Combined improvement: {formatNumber(point.combined_improvement, 1)}</div>
      </div>
    </div>
  );
}

export default function AgentGaResultSummaryPanel({
  flightsPaneOpen = true,
  onFlightsPaneOpenChange,
  run,
}: AgentGaResultSummaryPanelProps) {
  const [frontier, setFrontier] = useState<GaParetoFrontierResponse | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPointId(null);
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ run_id: run.runId });
        const response = await authFetch(
          `/api/ga_posthoc_frontier?${params.toString()}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || `Failed to fetch GA Pareto frontier (${response.status})`);
        }
        const payload = (await response.json()) as GaParetoFrontierResponse;
        if (cancelled) return;
        setFrontier(payload);
        setSelectedPointId(payload.default_point_id);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setFrontier(null);
        setError(err instanceof Error ? err.message : 'Failed to fetch GA Pareto frontier');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [run.runId, run.runKey]);

  const selectedPoint = useMemo(
    () => frontier?.points.find((point) => point.point_id === selectedPointId) ?? null,
    [frontier?.points, selectedPointId],
  );
  const selectedSeries = selectedPoint ? [selectedPoint] : [];

  const frontierSelector = (
    <div className="rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.08] via-black/25 to-slate-950/50 p-5 shadow-[0_18px_44px_-28px_rgba(251,191,36,0.75)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white/90">Pareto Frontier</h2>
            <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
              Select a point
            </span>
          </div>
          <p className="mt-1 text-sm text-white/55">
            Choose the capacity-relief and delay tradeoff to inspect its complete solution.
          </p>
        </div>
        {selectedPoint ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-1 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-xs">
            <span className="text-white/45">Selected</span>
            <span className="text-right font-semibold text-amber-200">
              {selectedPoint.point_id}{selectedPoint.is_knee ? ' · Knee' : ''}
            </span>
            <span className="text-white/45">Capacity relief</span>
            <span className="text-right text-emerald-200">
              {formatNumber(selectedPoint.capacity_improvement, 1)}
            </span>
            <span className="text-white/45">Delay</span>
            <span className="text-right text-white/85">
              {formatNumber(selectedPoint.delay_minutes, 1)} min
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-5 h-[360px] rounded-xl border border-white/10 bg-slate-950/60 p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <ShimmeringText
              text="Loading Pareto frontier…"
              className="text-sm font-normal text-white/60"
            />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 text-sm text-rose-100">
            {error}
          </div>
        ) : frontier?.points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 14, right: 22, bottom: 22, left: 12 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis
                type="number"
                dataKey="delay_minutes"
                name="Total delay"
                unit=" min"
                tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                tickLine={false}
                label={{
                  value: 'Total delay (minutes)',
                  position: 'insideBottom',
                  offset: -14,
                  fill: 'rgba(255,255,255,0.55)',
                  fontSize: 11,
                }}
              />
              <YAxis
                type="number"
                dataKey="capacity_improvement"
                name="Capacity relief"
                width={74}
                tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                tickLine={false}
                tickFormatter={(value: number) => formatNumber(value)}
                label={{
                  value: 'Capacity relief',
                  angle: -90,
                  position: 'insideLeft',
                  fill: 'rgba(255,255,255,0.55)',
                  fontSize: 11,
                }}
              />
              <Tooltip content={<ParetoTooltip />} />
              <Scatter
                data={frontier.points}
                fill="#38bdf8"
                line={{ stroke: 'rgba(56,189,248,0.45)', strokeWidth: 1.5 }}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(entry: unknown) => {
                  const candidate = entry as {
                    payload?: GaParetoPoint;
                    point_id?: string;
                  };
                  const pointId = candidate.payload?.point_id ?? candidate.point_id;
                  if (pointId) setSelectedPointId(pointId);
                }}
              />
              <Scatter
                data={selectedSeries}
                fill="#fbbf24"
                isAnimationActive={false}
              />
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/55">
            No Pareto points are available for this run.
          </div>
        )}
      </div>
    </div>
  );

  return (
    <AgentSaResultSummaryPanel
      run={run}
      mode="ga"
      selectedPointId={selectedPointId}
      leadingContent={frontierSelector}
      flightsPaneOpen={flightsPaneOpen}
      onFlightsPaneOpenChange={onFlightsPaneOpenChange}
    />
  );
}
