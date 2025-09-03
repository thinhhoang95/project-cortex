"use client";
import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import MultiSelectWithChips, { ChipOption } from "@/components/MultiSelectWithChips";
import ShimmeringText from "@/components/ShimmeringText";
import { loadSectors } from "@/lib/airspace";
import TimeScaleControl from "@/components/TimeScaleControl";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type CountsResponse = {
  time_bin_minutes: number;
  timebins: { start_bin: number; end_bin: number; labels: string[] };
  counts?: Record<string, number[]>;
  capacity?: Record<string, number[]>;
  mentioned_counts?: Record<string, number[]>;
  mentioned_capacity?: Record<string, number[]>;
  by_category?: Record<string, Record<string, number[]>>;
  by_category_mentioned?: Record<string, Record<string, number[]>>;
  metadata: {
    num_tvs?: number;
    num_mentioned?: number;
    num_bins?: number;
    rank_by?: string;
    top_k?: number;
    rolling_hour?: boolean;
    rolling_window_minutes?: number;
    ranked_tv_ids?: string[];
    missing_flight_ids?: string[];
  };
};

export default function OriginalCountPage() {
  const [options, setOptions] = useState<ChipOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selectedTVs, setSelectedTVs] = useState<string[]>([]);
  const [fromTime, setFromTime] = useState<string>("00:00");
  const [toTime, setToTime] = useState<string>("23:59");
  const [rollingHour, setRollingHour] = useState<boolean>(true);
  const [querying, setQuerying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CountsResponse | null>(null);
  // View-only time window for histogram (does not affect API params)
  const [viewFromTime, setViewFromTime] = useState<string>("00:00");
  const [viewToTime, setViewToTime] = useState<string>("23:59");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingOptions(true);
      try {
        const fc = await loadSectors("/data/airspace.geojson");
        if (cancelled) return;
        const opts: ChipOption[] = (fc.features || [])
          .map((f: any) => {
            const id = f?.properties?.traffic_volume_id;
            if (!id) return null;
            const minFL = f?.properties?.min_fl;
            const maxFL = f?.properties?.max_fl;
            return {
              id: String(id),
              label: String(id),
              description: (minFL != null && maxFL != null) ? `FL${String(minFL).padStart(3,'0')}-FL${String(maxFL).padStart(3,'0')}` : undefined,
            } as ChipOption;
          })
          .filter(Boolean) as ChipOption[];
        const seen = new Set<string>();
        const dedup = opts.filter((o) => {
          if (seen.has(o.id)) return false;
          seen.add(o.id);
          return true;
        }).sort((a, b) => a.id.localeCompare(b.id));
        setOptions(dedup);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load traffic volumes");
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const valid = useMemo(() => {
    const from = hhmmToSec(fromTime);
    const to = hhmmToSec(toTime);
    return to >= from; // inclusive window allowed by backend
  }, [fromTime, toTime]);

  const handleQuery = async () => {
    setError(null);
    setQuerying(true);
    setData(null);
    try {
      const payload: any = {
        // Only include TVs when user selects any
        ...(selectedTVs.length > 0 ? { traffic_volume_ids: selectedTVs } : {}),
        from_time_str: fromTime,
        to_time_str: toTime,
        rolling_hour: Boolean(rollingHour),
      };
      const res = await fetch('/api/original_counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      // After a successful query, align view window with request
      setViewFromTime(fromTime);
      setViewToTime(toTime);
    } catch (e: any) {
      setError(e?.message || 'Failed to query original counts');
    } finally {
      setQuerying(false);
    }
  };

  // Debug request payload (exactly what we'll POST)
  const debugPayload = useMemo(() => {
    const p: any = {
      from_time_str: fromTime,
      to_time_str: toTime,
      rolling_hour: Boolean(rollingHour),
    };
    if (selectedTVs.length > 0) p.traffic_volume_ids = selectedTVs;
    return p;
  }, [fromTime, toTime, rollingHour, selectedTVs]);

  const mentionedItems = useMemo(() => {
    const mc = data?.mentioned_counts || {};
    const mcap = data?.mentioned_capacity || {};
    const cap = data?.capacity || {};
    const labels = data?.timebins?.labels || [];
    const ids = Object.keys(mc);
    return ids.map((tv) => {
      const series = mc[tv] || [];
      const capacitySeries = (mcap[tv] ?? cap[tv]) || [];
      return { tvId: tv, series, labels, capacitySeries };
    });
  }, [data]);

  const topItems = useMemo(() => {
    const counts = data?.counts || {};
    const capacity = data?.capacity || {};
    const labels = data?.timebins?.labels || [];
    const order = data?.metadata?.ranked_tv_ids;
    const ids = order && order.length > 0 ? order.filter((id) => counts[id]) : Object.keys(counts);
    return ids.map((tv) => ({ tvId: tv, series: counts[tv] || [], capacitySeries: capacity[tv] || [], labels }));
  }, [data]);

  return (
    <main className="min-h-screen w-screen overflow-x-hidden bg-slate-900 relative">
      <Header />
      <div className="pt-16 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <div className="text-[11px] uppercase tracking-wider text-white/70">Analytics</div>
            <h1 className="text-2xl font-semibold text-white">Occupancy Counts</h1>
          </div>

          {/* Controls */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-end">
              <div className="md:col-span-2">
                <div className="text-[11px] opacity-80 mb-1 text-white">Traffic Volumes</div>
                <MultiSelectWithChips
                  options={options}
                  selectedIds={selectedTVs}
                  onChange={setSelectedTVs}
                  placeholder={loadingOptions ? "Loading traffic volumes…" : "Select traffic volumes"}
                  disabled={loadingOptions}
                  renderOptionLabel={(opt) => (
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                      <span>{opt.label}</span>
                    </div>
                  )}
                />
              </div>
              <div>
                <div className="text-[11px] opacity-80 mb-1 text-white">From</div>
                <input
                  type="time"
                  value={fromTime}
                  onChange={(e) => setFromTime(e.currentTarget.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              <div>
                <div className="text-[11px] opacity-80 mb-1 text-white">To</div>
                <input
                  type="time"
                  value={toTime}
                  onChange={(e) => setToTime(e.currentTarget.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-white/90">
                <input
                  type="checkbox"
                  checked={rollingHour}
                  onChange={(e) => setRollingHour(e.currentTarget.checked)}
                  className="accent-blue-500 scale-110"
                />
                <span className="text-sm">Rolling Hour</span>
              </label>
              <button
                onClick={handleQuery}
                disabled={!valid || querying}
                className={`px-3 py-2 rounded-lg border text-sm ${querying ? 'border-blue-400/50 bg-blue-500/20 text-blue-200' : valid ? 'border-white/30 bg-white/10 text-white/90 hover:bg-white/15' : 'opacity-50 cursor-not-allowed border-white/20 bg-white/5 text-white/60'}`}
              >
                {querying ? <ShimmeringText text="Querying..." /> : 'Query'}
              </button>
              {!valid && (
                <div className="text-[11px] text-red-200">End time must not be earlier than start time</div>
              )}
              {error && (
                <div className="text-[11px] text-red-200">{error}</div>
              )}
          </div>
          {/* Debug: Request JSON */}
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Request JSON</div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white/90 font-mono max-h-40 overflow-auto">
              {JSON.stringify(debugPayload, null, 2)}
            </div>
          </div>

          {/* Histogram view control */}
          <div className="mt-6">
            <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Histogram View Range</div>
            <TimeScaleControl
              time_from={viewFromTime}
              time_to={viewToTime}
              stepMinutes={data?.time_bin_minutes ?? 1}
              onCommit={(f, t) => { setViewFromTime(f); setViewToTime(t); }}
            />
          </div>
        </div>

          {/* Mentioned TVs */}
          <section className="mb-8">
            <div className="text-sm uppercase tracking-wider text-gray-300 mb-3">Mentioned Traffic Volumes</div>
            {data?.mentioned_counts && Object.keys(data.mentioned_counts).length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-2">
                {mentionedItems.map(({ tvId, series, labels, capacitySeries }) => (
                  <ChartCard
                    key={`m-${tvId}`}
                    tvId={tvId}
                    series={series}
                    capacitySeries={capacitySeries}
                    labels={labels}
                    minutesPerBin={data?.time_bin_minutes ?? 15}
                    showCapacity={rollingHour}
                    viewFromMin={Math.floor(hhmmToSec(viewFromTime)/60)}
                    viewToMin={Math.floor(hhmmToSec(viewToTime)/60)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-300">No specific traffic volumes selected.</div>
            )}
          </section>

          {/* Top TVs */}
          <section className="mb-4">
            <div className="text-sm uppercase tracking-wider text-gray-300 mb-3">Top Traffic Volumes</div>
            {data?.counts && Object.keys(data.counts).length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
                {topItems.map(({ tvId, series, labels, capacitySeries }) => (
                  <ChartCard
                    key={`t-${tvId}`}
                    tvId={tvId}
                    series={series}
                    capacitySeries={capacitySeries}
                    labels={labels}
                    minutesPerBin={data?.time_bin_minutes ?? 15}
                    showCapacity={rollingHour}
                    viewFromMin={Math.floor(hhmmToSec(viewFromTime)/60)}
                    viewToMin={Math.floor(hhmmToSec(viewToTime)/60)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-300">No data yet. Run a query.</div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function ChartCard({ tvId, series, labels, minutesPerBin, capacitySeries = [], showCapacity = false, viewFromMin, viewToMin }: { tvId: string; series: number[]; labels: string[]; minutesPerBin: number; capacitySeries?: number[]; showCapacity?: boolean; viewFromMin: number; viewToMin: number }) {
  const rows = useMemo(() => {
    const n = Math.min(series.length, labels.length);
    const arr = new Array(n).fill(0).map((_, i) => {
      const rawCap = capacitySeries[i];
      const capNum = Number(rawCap);
      const capacity = Number.isFinite(capNum) && capNum >= 0 ? capNum : null;
      const label = String(labels[i] || "");
      // Try to parse start HH:MM from label; accept formats like "HH:MM" or "HH:MM-HH:MM"
      let startLabel = label;
      const dashIdx = label.indexOf("-");
      if (dashIdx > 0) startLabel = label.slice(0, dashIdx);
      const parsed = hhmmToMinutes(startLabel);
      const startMin = Number.isFinite(parsed) ? parsed : i * minutesPerBin;
      return { idx: i, value: Number(series[i] ?? 0), capacity, startMin };
    });
    // Filter by view window
    const vFrom = Math.max(0, Math.floor(viewFromMin));
    const vTo = Math.min(24 * 60 - 1, Math.floor(viewToMin));
    return arr.filter((r) => r.startMin >= vFrom && r.startMin <= vTo);
  }, [series, labels, capacitySeries, minutesPerBin, viewFromMin, viewToMin]);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-white">{tvId}</div>
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="idx" tick={false} axisLine={false} tickLine={false} />
            <YAxis
              tick={true}
              axisLine={true}
              tickLine={true}
              width={1}
            />
            <Tooltip
              wrapperStyle={{ zIndex: 9999 }}
              contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
              formatter={(value: any, name: any) => [String(value), name === 'capacity' ? 'Capacity' : 'Count']}
              labelFormatter={(labelIdx: any) => {
                const idx = Number(labelIdx ?? 0);
                const l = labels[idx] || '';
                return l || binIndexToRangeLabel(idx, minutesPerBin);
              }}
            />
            <Bar dataKey="value" fill="#60a5fa" />
            {showCapacity && (
              <Line type="stepAfter" dataKey="capacity" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      
    </div>
  );
}

function hhmmToSec(hhmm: string): number {
  const [h, m] = (hhmm || '').split(":").map((x) => Number(x));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return Math.max(0, hh * 3600 + mm * 60);
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '').split(":").map((x) => Number(x));
  const hh = Number.isFinite(h) ? h : NaN;
  const mm = Number.isFinite(m) ? m : NaN;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  const total = hh * 60 + mm;
  return Math.max(0, Math.min(24 * 60 - 1, total));
}

function formatMinutesToHHMM(totalMinutes: number): string {
  const minutesInDay = 24 * 60;
  const m = ((Math.floor(totalMinutes) % minutesInDay) + minutesInDay) % minutesInDay;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function binIndexToRangeLabel(binIdx: number, minutesPerBin: number): string {
  const startMin = binIdx * minutesPerBin;
  const endMin = startMin + minutesPerBin;
  return `${formatMinutesToHHMM(startMin)}-${formatMinutesToHHMM(endMin)}`;
}
