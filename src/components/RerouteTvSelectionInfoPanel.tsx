"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import { normalizeCapacity } from "@/lib/capacity";
import {
  buildMergedMultiTvChartRows,
  buildRollingChartDataFromOccupancy,
  type RollingChartDataPoint,
} from "@/lib/airspaceInfoMultiTv";
import TrafficOverloadBar, { type TrafficOverloadDatum } from "@/components/TrafficOverloadBar";

type OccupancyData = {
  traffic_volume_id: string;
  occupancy_counts: Record<string, number>;
  hourly_capacity: Record<string, number>;
  anchor_capacity?: Record<string, number>;
  metadata: {
    time_bin_minutes: number;
    total_time_windows: number;
    total_flights_in_tv: number;
  };
};

type ChartSeries = {
  tvId: string;
  countKey: string;
  capacityKey: string;
  color: string;
  isPrimary: boolean;
};

const CHART_COLORS = ["#06b6d4", "#f59e0b", "#10b981", "#ec4899", "#a78bfa"];

type RerouteTvSelectionInfoPanelProps = {
  embedded?: boolean;
};

export default function RerouteTvSelectionInfoPanel({ embedded = false }: RerouteTvSelectionInfoPanelProps) {
  const { selectedTrafficVolume, selectedTrafficVolumes, airspaceDisplayMode, t, setT } = useSimStore();

  const selectedTvIds = useMemo(() => {
    const source =
      Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0
        ? selectedTrafficVolumes
        : selectedTrafficVolume
          ? [selectedTrafficVolume]
          : [];

    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of source) {
      const id = String(raw ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [selectedTrafficVolume, selectedTrafficVolumes]);

  const selectedTvKey = selectedTvIds.join("|");
  const primaryTvId = selectedTvIds[0] ?? null;

  const [occupancyByTv, setOccupancyByTv] = useState<Record<string, OccupancyData>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const reqId = ++reqRef.current;

    if (airspaceDisplayMode !== "tv" || selectedTvIds.length === 0) {
      setOccupancyByTv({});
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    Promise.all(
      selectedTvIds.map(async (tvId) => {
        const response = await authFetch(
          `/api/tv_count_with_capacity?traffic_volume_id=${encodeURIComponent(tvId)}`
        );

        if (!response.ok) {
          const json = await response.json().catch(() => ({}));
          const message = typeof json?.error === "string" ? json.error : `Failed to fetch ${tvId}`;
          throw new Error(message);
        }

        const payload = (await response.json()) as OccupancyData;
        return [tvId, payload] as const;
      })
    )
      .then((entries) => {
        if (reqId !== reqRef.current) return;
        setOccupancyByTv(Object.fromEntries(entries));
        setLoading(false);
      })
      .catch((err) => {
        if (reqId !== reqRef.current) return;
        setLoading(false);
        setOccupancyByTv({});
        setError(err instanceof Error ? err.message : "Failed to load occupancy data");
      });
  }, [airspaceDisplayMode, selectedTvKey, selectedTvIds]);

  const chartSeries = useMemo<ChartSeries[]>(() => {
    return selectedTvIds.map((tvId, idx) => ({
      tvId,
      countKey: `count_${idx}`,
      capacityKey: `capacity_${idx}`,
      color: CHART_COLORS[idx % CHART_COLORS.length],
      isPrimary: idx === 0,
    }));
  }, [selectedTvIds]);

  const mergedChartRows = useMemo(() => {
    const chartDataByTv: Record<string, RollingChartDataPoint[]> = {};
    const keyByTv: Record<string, { countKey: string; capacityKey: string }> = {};

    for (const series of chartSeries) {
      const data = occupancyByTv[series.tvId];
      const { chartData } = buildRollingChartDataFromOccupancy(data);
      chartDataByTv[series.tvId] = chartData;
      keyByTv[series.tvId] = {
        countKey: series.countKey,
        capacityKey: series.capacityKey,
      };
    }

    return buildMergedMultiTvChartRows({
      selectedTvIds,
      chartDataByTv,
      keyByTv,
    });
  }, [chartSeries, occupancyByTv, selectedTvIds]);

  const primaryOccupancy = primaryTvId ? occupancyByTv[primaryTvId] : null;

  const primarySummary = useMemo(() => {
    if (!primaryOccupancy) {
      return { currentCount: null as number | null, currentCapacity: null as number | null, movements: 0 };
    }

    const { currentCount, currentCapacity } = resolveCurrentValues(primaryOccupancy, t);

    return {
      currentCount,
      currentCapacity,
      movements: Number(primaryOccupancy.metadata?.total_flights_in_tv || 0),
    };
  }, [primaryOccupancy, t]);

  const overloadSegments = useMemo(() => {
    if (!primaryOccupancy) {
      return { fromTime: "00:00", toTime: "24:00", data: [] as TrafficOverloadDatum[] };
    }

    const entries = Object.entries(primaryOccupancy.occupancy_counts || {}).map(([window, count]) => {
      const [start = "00:00"] = String(window).split("-");
      const [h = 0, m = 0] = start.split(":").map(Number);
      const startKey = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const hourKey = `${String(h).padStart(2, "0")}:00-${String(h + 1).padStart(2, "0")}:00`;
      const capacity = normalizeCapacity(
        primaryOccupancy.anchor_capacity?.[startKey] ?? primaryOccupancy.hourly_capacity?.[hourKey]
      );
      return {
        window: String(window),
        startSeconds: h * 3600 + m * 60,
        count: Number(count ?? 0),
        capacity,
      };
    });

    entries.sort((a, b) => a.startSeconds - b.startSeconds);

    const data: TrafficOverloadDatum[] = entries.map((entry) => {
      const capacity = entry.capacity;
      const ratio = capacity && capacity > 0 ? entry.count / capacity : 0;
      const isOver = capacity !== undefined && capacity !== null && entry.count > capacity;

      let color = "#34d399";
      if (isOver) {
        if (ratio >= 1.4) color = "#b91c1c";
        else if (ratio >= 1.2) color = "#f97316";
        else color = "#fb923c";
      }

      return {
        period: entry.window,
        color,
        label: primaryTvId ? `${primaryTvId} load` : "TV load",
        metadata: [
          `Occupancy: ${entry.count.toFixed(0)}`,
          `Capacity: ${capacity != null ? capacity.toFixed(0) : "N/A"}`,
        ],
      };
    });

    const first = entries[0]?.window ?? "00:00-01:00";
    const last = entries[entries.length - 1]?.window ?? "23:00-24:00";

    return {
      fromTime: String(first).split("-")[0] || "00:00",
      toTime: String(last).split("-")[1] || "24:00",
      data,
    };
  }, [primaryOccupancy, primaryTvId]);

  if (airspaceDisplayMode !== "tv") {
    return (
      <div className="w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white p-4">
        <h2 className="font-semibold">Selected TV Information</h2>
        <p className="text-xs opacity-70 mt-2">Traffic volume charts are available in TV mode.</p>
      </div>
    );
  }

  if (selectedTvIds.length === 0) {
    return null;
  }

  return (
    <div
      className={
        embedded
          ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
          : "rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
      }
    >
      <div className="p-4 border-b border-white/20">
        <h2 className="font-semibold">Selected TV Information</h2>
        <p className="text-xs opacity-70 mt-1">
          {selectedTvIds.length === 1
            ? `TV ${selectedTvIds[0]}`
            : `Intersection context across ${selectedTvIds.length} TVs`}
        </p>
      </div>

      <div className="p-4 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]" />
            <span className="ml-2 text-xs opacity-70">Loading occupancy...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-2">
            <p className="text-xs text-red-200">Error: {error}</p>
          </div>
        )}

        {!loading && !error && primaryOccupancy && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/10 rounded-lg p-3">
                <p className="text-xs opacity-70">Movements</p>
                <p className="text-lg font-semibold">{primarySummary.movements.toLocaleString("en-US")}</p>
              </div>
              <div className="bg-white/10 rounded-lg p-3">
                <p className="text-xs opacity-70">Current Count</p>
                <p className="text-lg font-semibold">
                  {primarySummary.currentCount != null ? primarySummary.currentCount.toFixed(0) : "—"}
                </p>
              </div>
              <div className="bg-white/10 rounded-lg p-3">
                <p className="text-xs opacity-70">Capacity</p>
                <p className="text-lg font-semibold">
                  {primarySummary.currentCapacity != null ? primarySummary.currentCapacity.toFixed(0) : "—"}
                </p>
              </div>
            </div>

            {mergedChartRows.length > 0 && (
              <div className="bg-white/5 rounded-lg p-4">
                <h4 className="font-medium text-sm mb-3 opacity-90">Rolling Occupancy & Capacity</h4>
                <div style={{ width: "100%", height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={mergedChartRows} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis
                        dataKey="time"
                        tick={{ fill: "#e2e8f0", fontSize: 10 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        interval={0}
                        tickMargin={0}
                        height={16}
                      />
                      <YAxis
                        tick={{ fill: "#e2e8f0", fontSize: 10 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickMargin={0}
                        width={32}
                      />
                      <Tooltip content={<TvTooltip chartSeries={chartSeries} />} />

                      {chartSeries.map((series) => (
                        <Bar
                          key={series.countKey}
                          dataKey={series.countKey}
                          fill={series.color}
                          fillOpacity={series.isPrimary ? 0.95 : 0.55}
                          radius={[2, 2, 0, 0]}
                          isAnimationActive={false}
                          onClick={(_, index) => {
                            const row = mergedChartRows[index as number];
                            if (!row) return;
                            const hour = Number(row.hour);
                            if (Number.isFinite(hour)) setT(hour * 3600);
                          }}
                          style={{ cursor: "pointer" }}
                        />
                      ))}

                      {chartSeries.map((series) => (
                        <Line
                          key={series.capacityKey}
                          type="linear"
                          dataKey={series.capacityKey}
                          stroke={series.color}
                          strokeWidth={series.isPrimary ? 2.25 : 1.5}
                          strokeDasharray={series.isPrimary ? "0" : "4 3"}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      ))}

                      <ReferenceLine
                        x={nearestCategoryForTime(mergedChartRows, t)}
                        stroke="#ef4444"
                        strokeWidth={2}
                        strokeDasharray="0"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {overloadSegments.data.length > 0 && (
              <div className="bg-white/5 rounded-lg p-4">
                <h4 className="font-medium text-sm opacity-90 mb-3">Traffic Volume Load (Primary TV)</h4>
                <TrafficOverloadBar
                  fromTime={overloadSegments.fromTime}
                  toTime={overloadSegments.toTime}
                  data={overloadSegments.data}
                  height={16}
                  showTime
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TvTooltip(props: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number }>; label?: string; chartSeries: ChartSeries[] }) {
  const { active, payload, label, chartSeries } = props;
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-white/20 bg-slate-900/90 px-3 py-2 text-xs text-white shadow-lg">
      <div className="font-semibold mb-1">{label}</div>
      {chartSeries.map((series) => {
        const count = payload.find((entry) => entry.dataKey === series.countKey)?.value;
        const capacity = payload.find((entry) => entry.dataKey === series.capacityKey)?.value;

        return (
          <div key={series.tvId} className="flex items-center gap-2 whitespace-nowrap">
            <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: series.color }} />
            <span>{series.tvId}</span>
            <span className="opacity-80">Count: {formatNumeric(count)}</span>
            <span className="opacity-70">Cap: {formatNumeric(capacity)}</span>
          </div>
        );
      })}
    </div>
  );
}

function resolveCurrentValues(data: OccupancyData, t: number): { currentCount: number | null; currentCapacity: number | null } {
  const entries = Object.entries(data.occupancy_counts || {});
  const current = Number.isFinite(t) ? Math.floor(t) : 0;

  for (const [window, count] of entries) {
    const [start, end] = String(window).split("-");
    const startSeconds = parseHHMMToSeconds(start);
    const endSeconds = parseHHMMToSeconds(end);
    if (startSeconds === null || endSeconds === null) continue;

    const inWindow =
      endSeconds >= startSeconds
        ? current >= startSeconds && current < endSeconds
        : current >= startSeconds || current < endSeconds;

    if (!inWindow) continue;

    const startKey = start;
    const startHour = Math.floor(startSeconds / 3600);
    const hourKey = `${String(startHour).padStart(2, "0")}:00-${String(startHour + 1).padStart(2, "0")}:00`;
    const capacity = normalizeCapacity(data.anchor_capacity?.[startKey] ?? data.hourly_capacity?.[hourKey]);

    return {
      currentCount: Number(count ?? 0),
      currentCapacity: capacity ?? null,
    };
  }

  return { currentCount: null, currentCapacity: null };
}

function nearestCategoryForTime(rows: Array<{ time: string; hour: number }>, t: number): string | undefined {
  if (!rows.length) return undefined;
  const targetHour = Number.isFinite(t) ? t / 3600 : 0;

  let best = rows[0];
  let bestDiff = Math.abs(Number(rows[0].hour) - targetHour);
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const diff = Math.abs(Number(row.hour) - targetHour);
    if (diff < bestDiff) {
      best = row;
      bestDiff = diff;
    }
  }

  return best.time;
}

function parseHHMMToSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  return hours * 3600 + minutes * 60;
}

function formatNumeric(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return value.toFixed(0);
}
