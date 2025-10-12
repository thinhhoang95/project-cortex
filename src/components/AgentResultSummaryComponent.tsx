'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/auth';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface AgentSolSummaryResponse {
  runs: AgentRunSummary[];
}

interface AgentRunSummary {
  run_id: string;
  best_total_improvement: number | null;
  solutions: AgentSolutionSummary[];
  metadata?: AgentRunMetadata;
}

interface AgentSolutionSummary {
  rank: number;
  total_improvement: number | null;
  trajectory_length: number | null;
}

interface AgentRunMetadata {
  selected_row_kind?: string;
  last_updated?: string;
  total_rows?: number;
  source_csv?: string;
  historical_best?: HistoricalBestEntry[];
}

interface HistoricalBestEntry {
  ts_iso: string;
  best_total_improvement: number | null;
}

interface AgentResultSummaryComponentProps {
  className?: string;
  /**
   * Optional override for the API path (defaults to `/api/agent_sol_summary`)
   * to make mocking and testing easier.
   */
  endpoint?: string;
  initialRunId?: string;
}

function formatImprovement(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  const formatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  });
  return `+${formatter.format(value)}`;
}

function formatTrajectoryLength(length: number | null | undefined): string {
  if (length === null || length === undefined || Number.isNaN(length)) {
    return 'Unknown length';
  }
  if (length === 1) {
    return '1 step';
  }
  return `${length} steps`;
}

const historicalTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const { label, value } = entry;
  return (
    <div className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-white shadow-md backdrop-blur">
      <div className="font-medium text-white/90">{label}</div>
      <div className="text-emerald-300">{formatImprovement(value)}</div>
    </div>
  );
};

export default function AgentResultSummaryComponent({
  className = '',
  endpoint = '/api/agent_sol_summary',
  initialRunId,
}: AgentResultSummaryComponentProps) {
  const [data, setData] = useState<AgentSolSummaryResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => initialRunId ?? null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialRunId) return;
    setSelectedRunId((current) => (current === initialRunId ? current : initialRunId));
  }, [initialRunId]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function fetchSummary() {
      try {
        setLoading(true);
        setError(null);
        const response = await authFetch(endpoint, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as AgentSolSummaryResponse;
        if (cancelled) return;
        setData(payload);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load summary');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchSummary();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [endpoint]);

  useEffect(() => {
    if (!data?.runs?.length) return;
    setSelectedRunId((current) => {
      const runs = data.runs;
      const hasCurrent = current && runs.some((run) => run.run_id === current);
      if (hasCurrent) {
        return current;
      }
      const preferred =
        initialRunId && runs.some((run) => run.run_id === initialRunId)
          ? initialRunId
          : runs[0]?.run_id ?? null;
      return preferred ?? null;
    });
  }, [data, initialRunId]);

  const selectedRun = useMemo(() => {
    if (!selectedRunId || !data?.runs?.length) return null;
    return data.runs.find((run) => run.run_id === selectedRunId) ?? null;
  }, [data, selectedRunId]);

  return (
    <div
      className={`grid min-h-[560px] grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(300px,360px)] overflow-hidden text-white ${className}`}
    >
      <aside className="agent-result-summary__runs-pane flex flex-col overflow-hidden border-r border-white/5 bg-slate-950/70">
        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-5">
          {loading && (
            <div className="flex h-full items-center justify-center text-sm text-white/60">
              Loading agent summary…
            </div>
          )}
          {!loading && error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {!loading && !error && !data?.runs?.length && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
              No agent runs available yet.
            </div>
          )}
          {!loading && !error && data?.runs?.length ? (
            <div className="space-y-4">
              {data.runs.map((run) => {
                const isSelected = run.run_id === selectedRunId;
                const chartData =
                  run.metadata?.historical_best?.map((entry) => ({
                    time: new Date(entry.ts_iso).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                    value:
                      entry.best_total_improvement !== null &&
                      entry.best_total_improvement !== undefined
                        ? entry.best_total_improvement
                        : Number.NaN,
                  })) ?? [];

                return (
                  <button
                    key={run.run_id}
                    type="button"
                    onClick={() => setSelectedRunId(run.run_id)}
                    aria-pressed={isSelected}
                    className={`group block w-full rounded-2xl border px-5 py-4 text-left transition-all duration-150 ${
                      isSelected
                        ? 'border-emerald-400/70 bg-emerald-400/10 shadow-[0_18px_40px_-24px_rgba(16,185,129,0.8)]'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-medium text-white/60">
                          Run ID
                        </div>
                        <div className="mt-1 text-lg font-semibold text-white">
                          {run.run_id}
                        </div>
                      </div>
                      <div className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                        {formatImprovement(run.best_total_improvement)}
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {run.solutions.map((solution) => (
                        <div
                          key={`${run.run_id}-solution-${solution.rank}`}
                          className="rounded-xl border border-white/5 bg-black/20 px-4 py-3 transition group-hover:border-white/10"
                        >
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-white/85">
                              Rank {solution.rank}
                            </span>
                            <span className="font-semibold text-emerald-200">
                              {formatImprovement(solution.total_improvement)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-white/50">
                            {formatTrajectoryLength(solution.trajectory_length)}
                          </div>
                        </div>
                      ))}
                    </div>

                    {chartData.length > 0 && (
                      <div className="mt-4 h-24 rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData}>
                            <XAxis
                              dataKey="time"
                              tickLine={false}
                              axisLine={false}
                              tickMargin={8}
                              tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }}
                            />
                            <YAxis domain={['auto', 'auto']} tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} />
                            <Tooltip content={historicalTooltip} />
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke="rgba(52, 211, 153, 0.9)"
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 4, strokeWidth: 0 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </aside>

      <section className="agent-result-summary__details-pane relative flex flex-col bg-slate-950/60">
        {!selectedRun && !loading && !error && (
          <div className="flex h-full items-center justify-center text-sm text-white/50">
            Select a run to view its solutions.
          </div>
        )}
      </section>

      <aside className="agent-result-summary__flights-pane relative flex flex-col border-l border-white/5 bg-slate-950/75" />
    </div>
  );
}
