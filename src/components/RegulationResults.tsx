"use client";
import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from "recharts";
import { RegulationPlanSimulationResponse } from "@/lib/models";

interface RegulationResultsProps {
  open: boolean;
  result: RegulationPlanSimulationResponse | null;
  onClose: () => void;
}

function formatSecondsToHMM(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "-";
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function RegulationResults({ open, result, onClose }: RegulationResultsProps) {
  const items = useMemo(() => {
    const tvs = result?.rolling_top_tvs ?? [];
    return tvs.slice(0, 25).map((tv) => {
      const pre = tv.pre_rolling_counts || [];
      const post = tv.post_rolling_counts || [];
      const n = Math.min(pre.length, post.length);
      const data: Array<{ idx: number; base: number; inc: number; dec: number; pre: number; post: number; cap?: number }>
        = new Array(n).fill(0).map((_, i) => {
          const p0 = Number(pre[i] ?? 0);
          const p1 = Number(post[i] ?? 0);
          const base = Math.min(p0, p1);
          const inc = Math.max(0, p1 - p0);
          const dec = Math.max(0, p0 - p1);
          const cap = Number((tv.capacity_per_bin || [])[i] ?? undefined);
          return { idx: i, base, inc, dec, pre: p0, post: p1, cap: Number.isFinite(cap) ? cap : undefined };
        });
      return { tvId: tv.traffic_volume_id, data };
    });
  }, [result]);

  if (!open || !result) return null;

  const ds = result.delay_stats;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-[14px]" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="w-[min(980px,95vw)] h-[min(860px,92vh)] rounded-2xl border border-white/20 bg-slate-800/70 backdrop-blur-2xl shadow-2xl text-white overflow-hidden relative">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5">
            <div className="text-2xl font-semibold">Simulation Results</div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 border border-white/10">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>
            </button>
          </div>

          <div className="h-[calc(100%-64px)] overflow-y-auto p-6 space-y-6">
            {/* Delay stats */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-sm uppercase tracking-wider text-gray-300 mb-3">Delay Stats</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <Stat label="Total Delay" value={`${Math.round(ds.total_delay_seconds).toLocaleString()} s`} sub={formatSecondsToHMM(ds.total_delay_seconds)} />
                <Stat label="Mean Delay" value={`${Math.round(ds.mean_delay_seconds).toLocaleString()} s`} sub={formatSecondsToHMM(ds.mean_delay_seconds)} />
                <Stat label="Max Delay" value={`${Math.round(ds.max_delay_seconds).toLocaleString()} s`} sub={formatSecondsToHMM(ds.max_delay_seconds)} />
                <Stat label="Min Delay" value={`${Math.round(ds.min_delay_seconds).toLocaleString()} s`} sub={formatSecondsToHMM(ds.min_delay_seconds)} />
                <Stat label="Delayed Flights" value={`${ds.delayed_flights_count.toLocaleString()}`} />
                <Stat label="Flights" value={`${ds.num_flights.toLocaleString()}`} />
              </div>
            </div>

            {/* 5x5 grid charts */}
            <div>
              <div className="text-sm uppercase tracking-wider text-gray-300 mb-3">Rolling-hour Occupancy Diff (Post vs Pre)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                {items.map(({ tvId, data }) => (
                  <div key={tvId} className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">{tvId}</div>
                    </div>
                    <div className="h-36">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="idx" tick={false} axisLine={false} tickLine={false} />
                          <YAxis tick={false} axisLine={false} tickLine={false} width={0} />
                          <Tooltip
                            contentStyle={{ background: "rgba(15,23,42,0.9)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
                            formatter={(value, name, ctx: any) => {
                              const i = ctx?.payload?.idx ?? 0;
                              const pre = ctx?.payload?.pre ?? 0;
                              const post = ctx?.payload?.post ?? 0;
                              const cap = ctx?.payload?.cap;
                              if (name === 'inc') return [`+${value}`, 'Post-Pre'];
                              if (name === 'dec') return [`-${value}`, 'Pre-Post'];
                              if (name === 'base') return [String(value), 'Base'];
                              return [String(value), String(name)];
                            }}
                            labelFormatter={(label, payload: any) => {
                              const p = Array.isArray(payload) && payload.length > 0 ? payload[0].payload : null;
                              const pre = p?.pre ?? 0;
                              const post = p?.post ?? 0;
                              const cap = p?.cap;
                              return `Bin ${label}  |  pre: ${pre}  post: ${post}${Number.isFinite(cap) ? `  cap: ${cap}` : ''}`;
                            }}
                          />
                          <Bar dataKey="base" stackId="a" fill="#60a5fa" name="base" />
                          <Bar dataKey="inc" stackId="a" fill="#ef4444" name="inc" />
                          <Bar dataKey="dec" stackId="a" fill="#22c55e" name="dec" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-900/30 rounded-lg p-3 border border-white/10">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-gray-300">{sub}</div>}
    </div>
  );
}


