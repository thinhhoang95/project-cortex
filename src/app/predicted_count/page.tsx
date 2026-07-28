"use client";
import { useMemo, useState } from "react";
import Header from "@/components/Header";
import GlobalTVBasket from "@/components/GlobalTVBasket";
import { useGlobalTVBasket } from "@/components/useGlobalTVBasket";
import ShimmeringText from "@/components/ShimmeringText";
import TimeScaleControl from "@/components/TimeScaleControl";
import TrafficVolumeInfoTooltip from "@/components/TrafficVolumeInfoTooltip";
import TrafficOverloadBar, { TrafficOverloadDatum } from "@/components/TrafficOverloadBar";
import SelectChevron from "@/components/SelectChevron";
import { useResourceDateGuard } from "@/components/useResourceDateGuard";
import { useSimStore } from "@/components/useSimStore";
import { useHotspotSettingsStore } from "@/components/useHotspotSettingsStore";
import { normalizeCapacity } from "@/lib/capacity";
import { resolveHotspotColor } from "@/lib/hotspotColoring";
import {
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Bar,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DemandResponse = {
  rolling_window_size: number;
  rolling_hour: boolean;
  traffic_volumes: Record<
    string,
    {
      time_bins: number[];
      demand_mean: number[];
      demand_var: number[];
      capacity: number[];
    }
  >;
  metadata: {
    count: number;
    sorting: string;
    time_bin_minutes: number;
    scenario_id?: string;
    scenario_name?: string;
    scenario_selected?: boolean;
    arrival_moments_path?: string;
  };
};

type ChartItem = {
  tvId: string;
  series: number[];
  capacitySeries: number[];
  varianceSeries: number[];
  timeBins: number[];
};

type ChartRow = {
  idx: number;
  value: number;
  capacity: number | null;
  variance: number;
  stdDev: number;
  probOverload: number | null;
  startMin: number;
  rangeLabel: string;
  startLabel: string;
};

export default function PredictedCountPage() {
  const resourceDate = useSimStore((state) => state.resourceDate);
  const [limitTv, setLimitTv] = useState<string>("50");
  const [tvSorting, setTvSorting] = useState<string>("highest_mean_exceedance");
  const [rollingHour, setRollingHour] = useState<boolean>(true);
  const [querying, setQuerying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DemandResponse | null>(null);
  const [viewFromTime, setViewFromTime] = useState<string>("00:00");
  const [viewToTime, setViewToTime] = useState<string>("23:59");
  const [showRequest, setShowRequest] = useState<boolean>(false);
  const [showResponse, setShowResponse] = useState<boolean>(false);
  const scenarioLabel = useMemo(() => {
    if (!data?.metadata) return null;
    if (data.metadata.scenario_name) return data.metadata.scenario_name;
    if (data.metadata.scenario_selected === false) return "Default scenario (none selected)";
    return null;
  }, [data]);

  const { hydrated, ready, user } = useResourceDateGuard();

  const rawTrafficVolumeItems = useMemo<ChartItem[]>(() => {
    if (!data?.traffic_volumes) return [];
    const entries = Object.entries(data.traffic_volumes);
    return entries.map(([tvId, tvData]) => ({
      tvId,
      series: tvData?.demand_mean || [],
      capacitySeries: tvData?.capacity || [],
      varianceSeries: tvData?.demand_var || [],
      timeBins: tvData?.time_bins || [],
    }));
  }, [data]);
  const rawTrafficVolumeIds = useMemo(
    () => rawTrafficVolumeItems.map((item) => item.tvId),
    [rawTrafficVolumeItems],
  );
  const basket = useGlobalTVBasket(rawTrafficVolumeIds);
  const trafficVolumeItems = useMemo(() => {
    const byId = new Map(rawTrafficVolumeItems.map((item) => [item.tvId, item]));
    return basket.orderedContextIds
      .map((id) => byId.get(id))
      .filter((item): item is ChartItem => Boolean(item));
  }, [basket.orderedContextIds, rawTrafficVolumeItems]);

  const handleQuery = async () => {
    setError(null);
    setQuerying(true);
    setData(null);
    try {
      const params = new URLSearchParams();
      const limitNum = Number(limitTv);
      if (Number.isFinite(limitNum) && limitNum > 0) {
        params.set("limit_tv", String(Math.floor(limitNum)));
      }
      if (tvSorting) params.set("tv_sorting", tvSorting);
      params.set("rolling_hour", rollingHour ? "true" : "false");
      const res = await (await import("@/lib/auth")).authFetch(`/api/demand?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      const json: DemandResponse = await res.json();
      setData(json);
      // Align view window with returned bins when possible
      const minutesPerBin = json?.metadata?.time_bin_minutes ?? 15;
      const allBins = Object.values(json.traffic_volumes || {})
        .flatMap((tv) => tv.time_bins || [])
        .filter((b) => Number.isFinite(b));
      if (allBins.length > 0) {
        const minBin = Math.min(...allBins);
        const maxBin = Math.max(...allBins);
        setViewFromTime(formatMinutesToHHMM(minBin * minutesPerBin));
        setViewToTime(formatMinutesToHHMMWith24((maxBin + 1) * minutesPerBin));
      } else {
        setViewFromTime("00:00");
        setViewToTime("23:59");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to query predicted demand");
    } finally {
      setQuerying(false);
    }
  };

  const debugPayload = useMemo(() => {
    const params: Record<string, any> = {
      limit_tv: limitTv ? Number(limitTv) : undefined,
      tv_sorting: tvSorting,
      rolling_hour: rollingHour,
    };
    return params;
  }, [limitTv, tvSorting, rollingHour]);

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
            <h1 className="text-2xl font-semibold text-white">Predicted Occupancy Counts</h1>
            {scenarioLabel && (
              <div className="mt-2 text-sm text-white/80">
                Scenario: {scenarioLabel}
                {data?.metadata?.scenario_selected === false && data?.metadata?.scenario_name
                  ? " (not selected on server)"
                  : ""}
              </div>
            )}
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <button
                onClick={handleQuery}
                disabled={querying}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-colors ${querying
                    ? "bg-gradient-to-r from-blue-500 to-cyan-400 text-white opacity-80 cursor-wait"
                    : "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/20 hover:from-blue-500 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                  }`}
              >
                {querying ? <ShimmeringText text="Querying..." /> : "Query"}
              </button>
              {error && <div className="text-[11px] text-red-200">{error}</div>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-end">
              <div className="md:col-span-2 xl:col-span-5">
                <GlobalTVBasket contextTvIds={rawTrafficVolumeIds} />
              </div>
              <div>
                <div className="text-[11px] opacity-80 mb-1 text-white">Limit traffic volumes</div>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={limitTv}
                  onChange={(e) => setLimitTv(e.currentTarget.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white"
                />
              </div>
              <div>
                <div className="text-[11px] opacity-80 mb-1 text-white">Sort by</div>
                <div className="relative">
                  <select
                    value={tvSorting}
                    onChange={(e) => setTvSorting(e.currentTarget.value)}
                    className="w-full appearance-none pl-3 pr-10 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white"
                  >
                    <option value="highest_mean_exceedance">Highest Mean Exceedance</option>
                    <option value="highest_mean_demand">Highest Mean Demand</option>
                  </select>
                  <SelectChevron />
                </div>
              </div>
              <div>
                <div className="text-[11px] opacity-80 mb-1 text-white">Rolling hour</div>
                <label className="inline-flex items-center gap-2 text-white/90">
                  <input
                    type="checkbox"
                    checked={rollingHour}
                    onChange={(e) => setRollingHour(e.currentTarget.checked)}
                    className="accent-blue-500 scale-110"
                  />
                  <span className="text-sm">Enabled</span>
                </label>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3 text-[12px]">
              <button
                onClick={() => setShowRequest((s) => !s)}
                className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15"
              >
                {showRequest ? "Hide Request" : "Show Request"}
              </button>
              <button
                onClick={() => setShowResponse((s) => !s)}
                className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15"
              >
                {showResponse ? "Hide Response" : "Show Response"}
              </button>
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

            <div className="mt-6">
              <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">
                Histogram View Range
              </div>
              <TimeScaleControl
                time_from={viewFromTime}
                time_to={viewToTime}
                stepMinutes={data?.metadata?.time_bin_minutes ?? 1}
                onCommit={(f, t) => {
                  setViewFromTime(f);
                  setViewToTime(t);
                }}
              />
            </div>
          </div>

          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm uppercase tracking-wider text-gray-300">Traffic Volumes</div>
                <div className="text-xs text-gray-300">
                  {data?.metadata?.count ? `${data.metadata.count} returned` : "Run a query to load demand."}
                  {data?.metadata?.sorting
                    ? ` · Sorted by ${data.metadata.sorting === "highest_mean_exceedance"
                      ? "Highest Mean Exceedance"
                      : data.metadata.sorting === "highest_mean_demand"
                        ? "Highest Mean Demand"
                        : data.metadata.sorting
                    }`
                    : ""}
                </div>
              </div>
              {scenarioLabel && (
                <div className="text-xs text-white/80 text-right">
                  Scenario: {scenarioLabel}
                  {data?.metadata?.scenario_selected === false && data?.metadata?.scenario_name
                    ? " (default applied)"
                    : ""}
                </div>
              )}
            </div>
            {trafficVolumeItems.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
                {trafficVolumeItems.map(({ tvId, series, capacitySeries, varianceSeries, timeBins }) => (
                  <ChartCard
                    key={tvId}
                    tvId={tvId}
                    series={series}
                    capacitySeries={capacitySeries}
                    varianceSeries={varianceSeries}
                    timeBins={timeBins}
                    minutesPerBin={data?.metadata?.time_bin_minutes ?? 15}
                    showCapacity={true}
                    viewFromMin={Math.floor(hhmmToSec(viewFromTime) / 60)}
                    viewToMin={Math.floor(hhmmToSec(viewToTime) / 60)}
                    viewFromTime={viewFromTime}
                    viewToTime={viewToTime}
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

function ChartCard({
  tvId,
  series,
  capacitySeries,
  varianceSeries,
  timeBins,
  minutesPerBin,
  showCapacity = true,
  viewFromMin,
  viewToMin,
  viewFromTime,
  viewToTime,
}: {
  tvId: string;
  series: number[];
  capacitySeries: number[];
  varianceSeries: number[];
  timeBins: number[];
  minutesPerBin: number;
  showCapacity?: boolean;
  viewFromMin: number;
  viewToMin: number;
  viewFromTime: string;
  viewToTime: string;
}) {
  const hotspotSettings = useHotspotSettingsStore((state) => state.settings);
  const rows = useMemo(() => {
    const n = Math.min(series.length, timeBins.length);
    const arr: ChartRow[] = new Array(n).fill(0).map((_, i) => {
      const startMin = Number.isFinite(timeBins[i])
        ? Math.max(0, Math.floor(timeBins[i] * minutesPerBin))
        : i * minutesPerBin;
      const capacity = normalizeCapacity(capacitySeries[i]);
      const varianceVal = Number(varianceSeries[i]);
      const variance = Number.isFinite(varianceVal) && varianceVal >= 0 ? varianceVal : 0;
      const stdDev = Math.sqrt(variance);
      const value = Number(series[i] ?? 0);
      const probOverload = capacity != null ? probabilityOfOverload(value, stdDev, capacity) : null;
      return {
        idx: i,
        value,
        capacity,
        variance,
        stdDev,
        probOverload,
        startMin,
        rangeLabel: binIndexToRangeLabel(timeBins[i] ?? i, minutesPerBin),
        startLabel: formatMinutesToHHMM(startMin),
      };
    });
    const vFrom = Math.max(0, Math.floor(viewFromMin));
    const vTo = Math.min(24 * 60, Math.floor(viewToMin));
    return arr.filter((r) => r.startMin >= vFrom && r.startMin <= vTo);
  }, [series, capacitySeries, varianceSeries, timeBins, minutesPerBin, viewFromMin, viewToMin]);

  const overloadSegments = useMemo(() => {
    const segments: TrafficOverloadDatum[] = [];
    const binMinutes = Math.max(1, minutesPerBin);
    rows.forEach((row) => {
      if (row.capacity == null) return;
      const capacity = Number(row.capacity);
      const occupancy = Number(row.value);
      if (!Number.isFinite(capacity) || !Number.isFinite(occupancy)) return;
      const color = resolveHotspotColor({
        traffic_volume_id: tvId,
        hourly_occupancy: occupancy,
        hourly_capacity: capacity,
      }, hotspotSettings);
      if (!color) return;
      const startMinutes = row.startMin;
      const endMinutes = startMinutes + binMinutes;
      segments.push({
        period: `${formatMinutesToHHMM(startMinutes)}-${formatMinutesToHHMMWith24(endMinutes)}`,
        color,
        metadata: [
          `Mean demand: ${Math.round(occupancy)}`,
          `Capacity: ${capacity.toFixed(1)}`,
          `Exceedance: ${(occupancy - capacity).toFixed(1)}`,
        ],
        label: `${tvId} overload`,
      });
    });
    return segments;
  }, [hotspotSettings, rows, minutesPerBin, tvId]);

  const renderTooltip = ({ active, payload }: { active?: boolean; payload?: any[] }) => {
    if (!active || !payload?.length) return null;
    const datum: ChartRow | undefined = payload[0]?.payload;
    if (!datum) return null;

    return (
      <div className="bg-slate-900/90 backdrop-blur-sm border border-white/15 rounded-lg p-2 text-white text-xs">
        <div className="text-[11px] uppercase tracking-wide text-white/70 mb-1">{datum.rangeLabel}</div>
        <div className="text-sm text-blue-100">
          Mean Demand: <span className="font-semibold text-white">{Math.round(datum.value)}</span>
        </div>
        <div className="text-xs text-blue-200">
          Std Dev: <span className="font-semibold text-white">{datum.stdDev.toFixed(1)}</span>{" "}
          <span className="opacity-70">(Var {datum.variance.toFixed(1)})</span>
        </div>
        {datum.capacity != null && (
          <div className="text-xs text-amber-200">
            Capacity: <span className="font-semibold text-white">{datum.capacity.toFixed(1)}</span>
          </div>
        )}
        {datum.capacity != null && datum.probOverload != null && (
          <div className={`text-xs ${datum.probOverload > 0.5 ? "text-red-200" : "text-emerald-200"}`}>
            Prob. Overload: <span className="font-semibold text-white">{(datum.probOverload * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-white truncate">
          <TrafficVolumeInfoTooltip trafficVolumeId={tvId} className="truncate max-w-full">
            <span className="truncate">{tvId}</span>
          </TrafficVolumeInfoTooltip>
        </div>
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 6, left: 0, bottom: 16 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="startLabel"
              tick={{ fontSize: 10 }}
              axisLine={true}
              tickLine={true}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 10 }} axisLine={true} tickLine={true} allowDecimals={false} width={32} />
            <Tooltip wrapperStyle={{ zIndex: 9999 }} content={renderTooltip} />
            <Bar dataKey="value" fill="#60a5fa" stackId="demand" />
            <Bar dataKey="stdDev" fill="#38bdf8" stackId="demand" fillOpacity={0.55} />
            {showCapacity && (
              <Line
                type="stepAfter"
                dataKey="capacity"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4">
        <TrafficOverloadBar
          fromTime={viewFromTime}
          toTime={viewToTime}
          data={overloadSegments}
          showTime={overloadSegments.length > 0}
          showOkWhenNoData={false}
        />
      </div>
    </div>
  );
}

function hhmmToSec(hhmm: string): number {
  const [h, m] = (hhmm || "").split(":").map((x) => Number(x));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return Math.max(0, hh * 3600 + mm * 60);
}

function probabilityOfOverload(mean: number, stdDev: number, capacity: number): number {
  if (stdDev <= 0) {
    return mean > capacity ? 1 : 0;
  }
  const z = (capacity - mean) / stdDev;
  return 1 - normalCDF(z);
}

function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) prob = 1 - prob;
  return prob;
}

function formatMinutesToHHMM(totalMinutes: number): string {
  const minutesInDay = 24 * 60;
  const m = ((Math.floor(totalMinutes) % minutesInDay) + minutesInDay) % minutesInDay;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function formatMinutesToHHMMWith24(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "00:00";
  const clamped = Math.max(0, Math.floor(totalMinutes));
  if (clamped >= 24 * 60) {
    return "24:00";
  }
  return formatMinutesToHHMM(clamped);
}

function binIndexToRangeLabel(binIdx: number, minutesPerBin: number): string {
  const startMin = Math.max(0, Math.floor(binIdx * minutesPerBin));
  const endMin = startMin + minutesPerBin;
  return `${formatMinutesToHHMM(startMin)}-${formatMinutesToHHMMWith24(endMin)}`;
}
