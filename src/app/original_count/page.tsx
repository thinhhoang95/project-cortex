"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from 'next/navigation';
import { useSimStore } from '@/components/useSimStore';
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

type SortMode = "total" | "abs_change" | "exceedance";

type ChartSeriesItem = {
  tvId: string;
  series: number[];
  capacitySeries: number[];
  labels: string[];
  orderIndex: number;
};

export default function OriginalCountPage() {
  const router = useRouter();
  const user = useSimStore((state) => state.user);
  const [hydrated, setHydrated] = useState(false);
  const [options, setOptions] = useState<ChipOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selectedTVs, setSelectedTVs] = useState<string[]>([]);
  const [fromTime, setFromTime] = useState<string>("00:00");
  const [toTime, setToTime] = useState<string>("23:59");
  const [rollingHour, setRollingHour] = useState<boolean>(true);
  const [sortMode, setSortMode] = useState<SortMode>("exceedance");
  const [querying, setQuerying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CountsResponse | null>(null);
  // View-only time window for histogram (does not affect API params)
  const [viewFromTime, setViewFromTime] = useState<string>("00:00");
  const [viewToTime, setViewToTime] = useState<string>("23:59");
  const [showRequest, setShowRequest] = useState<boolean>(false);
  const [showResponse, setShowResponse] = useState<boolean>(false);

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

  const rankByParam = useMemo(() => getRankByParam(sortMode), [sortMode]);

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
        rank_by: rankByParam,
      };
      const res = await (await import("@/lib/auth")).authFetch('/api/original_counts', {
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
      rank_by: rankByParam,
    };
    if (selectedTVs.length > 0) p.traffic_volume_ids = selectedTVs;
    return p;
  }, [fromTime, toTime, rollingHour, selectedTVs, rankByParam]);

  const mentionedItems = useMemo<ChartSeriesItem[]>(() => {
    const mc = data?.mentioned_counts || {};
    const mcap = data?.mentioned_capacity || {};
    const cap = data?.capacity || {};
    const labels = data?.timebins?.labels || [];
    const ids = Object.keys(mc);
    return ids.map((tv, idx) => {
      const series = mc[tv] || [];
      const capacitySeries = (mcap[tv] ?? cap[tv]) || [];
      return { tvId: tv, series, labels, capacitySeries, orderIndex: idx };
    });
  }, [data]);

  const topItems = useMemo<ChartSeriesItem[]>(() => {
    const counts = data?.counts || {};
    const capacity = data?.capacity || {};
    const labels = data?.timebins?.labels || [];
    const order = data?.metadata?.ranked_tv_ids;
    const ids = order && order.length > 0 ? order.filter((id) => counts[id]) : Object.keys(counts);
    return ids.map((tv, idx) => ({
      tvId: tv,
      series: counts[tv] || [],
      capacitySeries: capacity[tv] || [],
      labels,
      orderIndex: idx,
    }));
  }, [data]);

  const minutesPerBin = Number(data?.time_bin_minutes ?? 15);
  const viewFromMinutes = useMemo(() => Math.max(0, Math.floor(hhmmToSec(viewFromTime) / 60)), [viewFromTime]);
  const viewToMinutes = useMemo(() => Math.min(24 * 60 - 1, Math.floor(hhmmToSec(viewToTime) / 60)), [viewToTime]);

  const preparedMentionedItems = useMemo(
    () => prepareSeriesItems(mentionedItems, minutesPerBin, viewFromMinutes, viewToMinutes),
    [mentionedItems, minutesPerBin, viewFromMinutes, viewToMinutes]
  );

  const preparedTopItems = useMemo(
    () => prepareSeriesItems(topItems, minutesPerBin, viewFromMinutes, viewToMinutes),
    [topItems, minutesPerBin, viewFromMinutes, viewToMinutes]
  );

  const sortedMentionedItems = useMemo(
    () => sortPreparedSeriesItems(preparedMentionedItems, sortMode),
    [preparedMentionedItems, sortMode]
  );

  const sortedTopItems = useMemo(
    () => sortPreparedSeriesItems(preparedTopItems, sortMode),
    [preparedTopItems, sortMode]
  );

  const canAbsChange = useMemo(() => {
    for (const item of preparedTopItems) {
      if (item.metrics.hasAbsBaseline) return true;
    }
    for (const item of preparedMentionedItems) {
      if (item.metrics.hasAbsBaseline) return true;
    }
    return false;
  }, [preparedTopItems, preparedMentionedItems]);

  const canExceed = useMemo(() => {
    for (const item of preparedTopItems) {
      if (item.metrics.hasCapacity) return true;
    }
    for (const item of preparedMentionedItems) {
      if (item.metrics.hasCapacity) return true;
    }
    return false;
  }, [preparedTopItems, preparedMentionedItems]);

  useEffect(() => {
    const hasAny = preparedTopItems.length > 0 || preparedMentionedItems.length > 0;
    if (!hasAny) return;
    if (!canAbsChange && sortMode === "abs_change") {
      setSortMode(canExceed ? "exceedance" : "total");
    } else if (!canExceed && sortMode === "exceedance") {
      setSortMode(canAbsChange ? "abs_change" : "total");
    }
  }, [canAbsChange, canExceed, sortMode, preparedTopItems.length, preparedMentionedItems.length]);

  // Ensure hooks are always called before any early return
  if (!hydrated || !user) {
    return null;
  }

  return (
    <main className="min-h-screen w-screen overflow-x-hidden analytics-surface relative">
      <Header />
      <div className="pt-16 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <div className="text-[11px] uppercase tracking-wider text-white/70">Analytics</div>
            <h1 className="text-2xl font-semibold text-white">Occupancy Counts</h1>
          </div>

          {/* Controls */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <button
                onClick={handleQuery}
                disabled={!valid || querying}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-colors ${querying ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white opacity-80 cursor-wait' : valid ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/20 hover:from-blue-500 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/40' : 'opacity-50 cursor-not-allowed border border-white/20 bg-white/5 text-white/60'}`}
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-end">
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
              <div>
                <div className="text-[11px] opacity-80 mb-1 text-white">TV Sort</div>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.currentTarget.value as SortMode)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white"
                >
                  <option value="total">Rank by Total</option>
                  <option
                    value="abs_change"
                    disabled={!canAbsChange}
                    title={!canAbsChange ? 'Requires capacity data or multiple in-view bins.' : undefined}
                  >
                    Rank by Absolute Changes
                  </option>
                  <option
                    value="exceedance"
                    disabled={!canExceed}
                    title={!canExceed ? 'Requires capacity data.' : undefined}
                  >
                    By Exceedances
                  </option>
                </select>
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
            </div>

            {/* Debug toggles */}
            <div className="mt-3 flex items-center gap-3 text-[12px]">
              <button
                onClick={() => setShowRequest((s) => !s)}
                className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15"
              >{showRequest ? 'Hide Request' : 'Show Request'}</button>
              <button
                onClick={() => setShowResponse((s) => !s)}
                className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15"
              >{showResponse ? 'Hide Response' : 'Show Response'}</button>
            </div>
            {showRequest && (
              <div className="mt-2 bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white/90 font-mono max-h-48 overflow-auto">
                {JSON.stringify(debugPayload, null, 2)}
              </div>
            )}
            {showResponse && data && (
              <div className="mt-2 bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white/90 font-mono max-h-72 overflow-auto">
                {JSON.stringify(data, null, 2)}
              </div>
            )}

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
                {sortedMentionedItems.map(({ tvId, series, labels, capacitySeries }) => (
                  <ChartCard
                    key={`m-${tvId}`}
                    tvId={tvId}
                    series={series}
                    capacitySeries={capacitySeries}
                    labels={labels}
                    minutesPerBin={minutesPerBin}
                    showCapacity={rollingHour}
                    viewFromMin={viewFromMinutes}
                    viewToMin={viewToMinutes}
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
                {sortedTopItems.map(({ tvId, series, labels, capacitySeries }) => (
                  <ChartCard
                    key={`t-${tvId}`}
                    tvId={tvId}
                    series={series}
                    capacitySeries={capacitySeries}
                    labels={labels}
                    minutesPerBin={minutesPerBin}
                    showCapacity={rollingHour}
                    viewFromMin={viewFromMinutes}
                    viewToMin={viewToMinutes}
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

type ChartRow = { idx: number; value: number; capacity: number | null; startMin: number };

type SeriesMetrics = {
  total: number;
  absChange: number;
  exceedance: number;
  hasCapacity: boolean;
  hasAbsBaseline: boolean;
};

type PreparedSeriesItem = ChartSeriesItem & { metrics: SeriesMetrics };

function prepareSeriesItems(
  items: ChartSeriesItem[],
  minutesPerBin: number,
  viewFromMin: number,
  viewToMin: number
): PreparedSeriesItem[] {
  return items.map((item) => {
    const rows = buildChartRows(item.series, item.labels, item.capacitySeries, minutesPerBin, viewFromMin, viewToMin);
    const metrics = computeSeriesMetrics(rows, minutesPerBin);
    return { ...item, metrics };
  });
}

function sortPreparedSeriesItems(items: PreparedSeriesItem[], mode: SortMode): PreparedSeriesItem[] {
  const arr = items.slice();
  arr.sort((a, b) => {
    const sa = getScoreForSortMode(a.metrics, mode);
    const sb = getScoreForSortMode(b.metrics, mode);
    if (sa !== sb) return sb - sa;
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
    return a.tvId.localeCompare(b.tvId);
  });
  return arr;
}

function getScoreForSortMode(metrics: SeriesMetrics, mode: SortMode): number {
  if (mode === "total") return metrics.total;
  if (mode === "abs_change") return metrics.absChange;
  return metrics.exceedance;
}

function computeSeriesMetrics(rows: ChartRow[], minutesPerBin: number): SeriesMetrics {
  const normalization = minutesPerBin > 0 ? minutesPerBin / 60 : 1;
  let total = 0;
  let absChange = 0;
  let exceedance = 0;
  let hasCapacity = false;
  let usedPrev = false;
  let prevValue: number | null = null;
  for (const row of rows) {
    const valRaw = Number(row.value ?? 0);
    const value = Number.isFinite(valRaw) ? valRaw : 0;
    total += value;
    const cap = row.capacity;
    if (cap != null && Number.isFinite(cap)) {
      hasCapacity = true;
      absChange += Math.abs(value - cap);
      exceedance += Math.max(0, value - cap) * normalization;
    } else if (prevValue != null) {
      absChange += Math.abs(value - prevValue);
      usedPrev = true;
    }
    prevValue = value;
  }
  return {
    total,
    absChange,
    exceedance,
    hasCapacity,
    hasAbsBaseline: hasCapacity || usedPrev,
  };
}

function buildChartRows(
  series: number[],
  labels: string[],
  capacitySeries: number[],
  minutesPerBin: number,
  viewFromMin: number,
  viewToMin: number
): ChartRow[] {
  const seriesLength = Array.isArray(series) ? series.length : 0;
  const labelCount = Array.isArray(labels) ? labels.length : 0;
  const n = labelCount > 0 ? Math.min(seriesLength, labelCount) : seriesLength;
  const safeMinutes = Number.isFinite(minutesPerBin) && minutesPerBin > 0 ? minutesPerBin : 1;
  const arr: ChartRow[] = new Array(n).fill(0).map((_, i) => {
    const rawCap = (capacitySeries || [])[i];
    const capNum = Number(rawCap);
    const capacity = Number.isFinite(capNum) && capNum >= 0 ? capNum : null;
    const rawVal = Number((series || [])[i] ?? 0);
    const value = Number.isFinite(rawVal) ? rawVal : 0;
    const label = String((labels || [])[i] || "");
    let startLabel = label;
    const dashIdx = label.indexOf("-");
    if (dashIdx > 0) startLabel = label.slice(0, dashIdx);
    const parsed = hhmmToMinutes(startLabel);
    const startMin = Number.isFinite(parsed) ? parsed : i * safeMinutes;
    return { idx: i, value, capacity, startMin };
  });
  const from = Math.max(0, Math.floor(viewFromMin));
  const to = Math.min(24 * 60 - 1, Math.floor(viewToMin));
  return arr.filter((r) => r.startMin >= from && r.startMin <= to);
}

function getRankByParam(mode: SortMode): string {
  switch (mode) {
    case "abs_change":
      return "total_abs_change";
    case "exceedance":
      return "total_excess";
    default:
      return "total_count";
  }
}

function ChartCard({ tvId, series, labels, minutesPerBin, capacitySeries = [], showCapacity = false, viewFromMin, viewToMin }: { tvId: string; series: number[]; labels: string[]; minutesPerBin: number; capacitySeries?: number[]; showCapacity?: boolean; viewFromMin: number; viewToMin: number }) {
  const rows = useMemo(
    () => buildChartRows(series, labels, capacitySeries || [], minutesPerBin, viewFromMin, viewToMin),
    [series, labels, capacitySeries, minutesPerBin, viewFromMin, viewToMin]
  );

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-white">{tvId}</div>
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 6, left: 0, bottom: 16 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="idx"
              tick={{ fontSize: 10 }}
              axisLine={true}
              tickLine={true}
              interval="preserveStartEnd"
              tickFormatter={(value: any) => {
                const idx = Number(value ?? 0);
                const l = labels[idx] || '';
                return l || binIndexToRangeLabel(idx, minutesPerBin);
              }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              axisLine={true}
              tickLine={true}
              allowDecimals={false}
              width={32}
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
