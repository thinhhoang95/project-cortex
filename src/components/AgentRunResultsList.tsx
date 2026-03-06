'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';
import ShimmeringText from '@/components/ShimmeringText';
import {
  type AgentRunMethodology,
  type AgentRunRef,
  type AgentSolListRun,
  normalizeAgentRunMethodology,
  toAgentRunRef,
} from '@/lib/agentRuns';

interface AgentSolListResponse {
  runs: AgentSolListRun[];
}

interface AgentRunResultsListProps {
  className?: string;
  endpoint?: string;
  onRunSelect?: (run: AgentRunRef) => void;
}

interface FetchState {
  loading: boolean;
  error: string | null;
  runs: AgentSolListRun[];
}

type StatusTone = 'success' | 'warning' | 'neutral';

const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  completed: {
    label: 'Completed',
    tone: 'success',
  },
  ongoing: {
    label: 'In Progress',
    tone: 'warning',
  },
};

const STATUS_TONE_CLASSES: Record<StatusTone, { badge: string; dot: string }> = {
  success: {
    badge: 'border border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
    dot: 'bg-emerald-400/90',
  },
  warning: {
    badge: 'border border-amber-400/35 bg-amber-500/10 text-amber-200',
    dot: 'bg-amber-300/90',
  },
  neutral: {
    badge:
      'border border-[color:var(--panel-divider)] bg-[var(--panel-bg)] text-[color:var(--panel-text-muted)]',
    dot: 'bg-slate-300/70',
  },
};

const METHODOLOGY_META: Record<
  AgentRunMethodology,
  { label: string; badge: string; subtitle: string }
> = {
  rz: {
    label: 'RZ',
    badge: 'border border-cyan-400/35 bg-cyan-500/10 text-cyan-100',
    subtitle: 'RZ optimization',
  },
  sa: {
    label: 'SA',
    badge: 'border border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-100',
    subtitle: 'SA optimization',
  },
};

function formatImprovement(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  const formatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  });
  const formatted = formatter.format(value);
  return value >= 0 ? `+${formatted}` : formatted;
}

function formatStatusText(value: string): string {
  const normalized = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Unknown';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function AgentRunResultsList({
  className = '',
  endpoint = '/api/agent_sol_ls',
  onRunSelect,
}: AgentRunResultsListProps) {
  const [{ runs, loading, error }, setState] = useState<FetchState>({
    runs: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function fetchRuns() {
      try {
        setState({ runs: [], loading: true, error: null });
        const response = await authFetch(endpoint, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as AgentSolListResponse;
        if (cancelled) return;
        setState({ runs: payload.runs ?? [], loading: false, error: null });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        setState({
          runs: [],
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load agent runs',
        });
      }
    }

    fetchRuns();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [endpoint]);

  const totalRunsLabel = loading || !!error ? '—' : runs.length;

  return (
    <section
      className={`glass-panel relative flex h-full min-h-[260px] flex-col rounded-[24px] text-left text-[color:var(--panel-text-primary)] backdrop-blur-xl shadow-[var(--panel-shadow)] ${className} overflow-y-auto no-scrollbar p-6`}
    >

      <h3 className="mt-2 text-xl font-semibold leading-tight text-[color:var(--panel-text-primary)]">
        Recent Runs
      </h3>

      <div className="mt-5 flex-1">
        {loading ? (
          <div className="glass-panel-muted flex min-h-[180px] flex-col items-center justify-center rounded-2xl px-6 py-12">
            <div className="mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[color:var(--panel-divider)] border-t-transparent" />
            <ShimmeringText
              text="Loading agent runs…"
              className="text-sm text-[color:var(--panel-text-muted)] font-normal"
              theme="dark"
            />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
            {error}
          </div>
        ) : runs.length === 0 ? (
          <div className="glass-panel-muted flex min-h-[180px] flex-col justify-center rounded-2xl px-5 py-8 text-sm leading-relaxed text-[color:var(--panel-text-muted)]">
            No agent runs yet. Once the agent finishes an optimization run, the summary will appear here.
          </div>
        ) : (
          <ul className="flex max-h-full flex-col gap-3">
            {runs.map((run) => {
              const status = STATUS_META[run.status] ?? {
                label: formatStatusText(run.status),
                tone: 'neutral' as const,
              };
              const methodology = normalizeAgentRunMethodology(run.methodology);
              const methodologyMeta = methodology ? METHODOLOGY_META[methodology] : null;
              const toneClasses = STATUS_TONE_CLASSES[status.tone];
              const improvementValue = run.best_total_improvement;
              const hasImprovement =
                typeof improvementValue === 'number' && !Number.isNaN(improvementValue);
              const improvementColor = !hasImprovement
                ? 'text-[color:var(--panel-text-muted)]'
                : improvementValue >= 0
                  ? 'text-emerald-300'
                  : 'text-rose-300';

              return (
                <li key={run.run_id}>
                  <button
                    type="button"
                    onClick={() => {
                      const ref = toAgentRunRef(run);
                      if (ref) {
                        onRunSelect?.(ref);
                      }
                    }}
                    className="glass-panel-muted w-full rounded-2xl px-5 py-4 text-left transition-all duration-200 hover:bg-[var(--panel-bg-strong)] hover:shadow-[var(--panel-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                    aria-label={`Show summary for ${methodologyMeta?.label ?? 'agent'} run ${run.run_id}`}
                  >
                    <div className="flex flex-wrap items-stretch justify-between gap-4">
                      <div className="flex flex-col gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] uppercase text-[color:var(--panel-text-muted)]">
                              Run Id
                            </span>
                            {methodologyMeta ? (
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${methodologyMeta.badge}`}
                              >
                                {methodologyMeta.label}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-lg font-semibold leading-6 text-[color:var(--panel-text-primary)]">
                            {run.run_id.toUpperCase()}
                          </p>
                          <p className="mt-1 text-xs text-[color:var(--panel-text-muted)]">
                            {methodologyMeta?.subtitle ?? 'Optimization run'}
                          </p>
                        </div>
                        <span
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium uppercase ${toneClasses.badge}`}
                        >
                          <span 
                            className={`h-2 w-2 rounded-full ${toneClasses.dot} ${run.status === 'ongoing' ? 'animate-pulse' : ''}`} 
                            aria-hidden="true" 
                          />
                          <span className={run.status === 'ongoing' ? 'animate-shimmer bg-gradient-to-r from-white/60 via-white/90 to-white/60 bg-[length:200%_100%] bg-clip-text text-transparent' : ''}>
                            {status.label}
                          </span>
                        </span>
                      </div>
                      <div className="flex flex-col justify-center gap-2 text-right">
                        <span className="text-[10px] uppercase text-[color:var(--panel-text-muted)]">
                          Best Total Δ
                        </span>
                        <span className={`text-2xl font-semibold leading-none ${improvementColor}`}>
                          {formatImprovement(run.best_total_improvement)}
                        </span>
                        <span className="text-xs text-[color:var(--panel-text-muted)]">
                          {methodology === 'sa' && !hasImprovement
                            ? 'cached summary unavailable'
                            : 'vs. baseline scenario'}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
