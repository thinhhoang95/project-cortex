"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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

import PanelCloseButton from "@/components/PanelCloseButton";
import ShimmeringText from "@/components/ShimmeringText";
import TrafficOverloadBar from "@/components/TrafficOverloadBar";
import { useDocumentTheme } from "@/components/useDocumentTheme";
import { useSimStore } from "@/components/useSimStore";
import { useHotspotSettingsStore } from "@/components/useHotspotSettingsStore";
import { authFetch } from "@/lib/auth";
import {
  buildRollingChartDataFromOccupancy,
  filterChartRowsByWindow,
  type RollingChartDataPoint,
} from "@/lib/airspaceInfoMultiTv";
import { normalizeCapacity } from "@/lib/capacity";
import { getTvScopeWindowSeconds } from "@/lib/radPreviewTvScope";
import type { SectorFeatureProps } from "@/lib/models";
import { formatFlightLevelRange } from "@/lib/trafficVolumeFormat";
import { getDerivedCapacityRangeForTvAsync } from "@/lib/tvCapacityRanges";
import { resolveHotspotColor } from "@/lib/hotspotColoring";

interface OccupancyData {
  traffic_volume_id: string;
  occupancy_counts: Record<string, number>;
  hourly_capacity: Record<string, number>;
  anchor_capacity?: Record<string, number>;
  metadata?: {
    time_bin_minutes?: number;
    total_time_windows?: number;
    total_flights_in_tv?: number;
  };
}

type RadAirspaceInfoProps = {
  trafficVolumeId: string;
  trafficVolumeData: { properties: SectorFeatureProps } | null;
  interestWindowLength: string;
  onInterestWindowLengthChange: (value: string) => void;
  onClear: () => void;
};

const WINDOW_LENGTH_OPTIONS = ["15", "30", "45", "1h", "2h", "4h", "6h"] as const;

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: RollingChartDataPoint }>;
  label?: string;
}) {
  if (!active) return null;
  const row = (payload || []).find((entry) => entry?.payload)?.payload;
  if (!row) return null;

  return (
    <div className="rounded-lg border border-white/20 bg-slate-800/90 p-2 text-xs text-white shadow-lg backdrop-blur-sm">
      <div className="font-medium">{label}</div>
      <div className="mt-1 text-white/80">Rolling occupancy: {Math.round(Number(row.count ?? 0))}</div>
      <div className="text-white/80">
        Anchor capacity:{" "}
        {typeof row.capacity === "number" && Number.isFinite(row.capacity) ? Math.round(row.capacity) : "N/A"}
      </div>
    </div>
  );
}

export default function RadAirspaceInfo({
  trafficVolumeId,
  trafficVolumeData,
  interestWindowLength,
  onInterestWindowLengthChange,
  onClear,
}: RadAirspaceInfoProps) {
  const shimmerTheme = useDocumentTheme();
  const hotspotSettings = useHotspotSettingsStore((state) => state.settings);
  const t = useSimStore((state) => state.t);
  const resourceStateEpoch = useSimStore((state) => state.resourceStateEpoch);
  const deferredT = useDeferredValue(t);
  const requestSeq = useRef(0);
  const [occupancyData, setOccupancyData] = useState<OccupancyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capacityRangeLabel, setCapacityRangeLabel] = useState<string | null>(null);

  useEffect(() => {
    setOccupancyData(null);
    setLoading(false);
    setError(null);
    setCapacityRangeLabel(null);
  }, [resourceStateEpoch, trafficVolumeId]);

  useEffect(() => {
    const reqId = ++requestSeq.current;
    setLoading(true);
    setError(null);

    authFetch(`/api/tv_count_with_capacity?traffic_volume_id=${encodeURIComponent(trafficVolumeId)}`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(payload.error || `Failed to fetch occupancy data (${response.statusText})`);
        }
        return response.json() as Promise<OccupancyData>;
      })
      .then((payload) => {
        if (reqId !== requestSeq.current) return;
        setOccupancyData(payload);
      })
      .catch((fetchError) => {
        if (reqId !== requestSeq.current) return;
        setOccupancyData(null);
        setError(fetchError instanceof Error ? fetchError.message : "Failed to fetch occupancy data");
      })
      .finally(() => {
        if (reqId !== requestSeq.current) return;
        setLoading(false);
      });
  }, [trafficVolumeId, resourceStateEpoch]);

  useEffect(() => {
    let cancelled = false;
    getDerivedCapacityRangeForTvAsync(trafficVolumeId)
      .then((label) => {
        if (!cancelled) setCapacityRangeLabel(label);
      })
      .catch(() => {
        if (!cancelled) setCapacityRangeLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trafficVolumeId]);

  const flightLevelRange = formatFlightLevelRange(
    trafficVolumeData?.properties?.min_fl,
    trafficVolumeData?.properties?.max_fl,
  );
  const windowSeconds = useMemo(
    () => getTvScopeWindowSeconds(interestWindowLength),
    [interestWindowLength],
  );
  const { chartData, timeBinMinutes } = useMemo(
    () => buildRollingChartDataFromOccupancy(occupancyData),
    [occupancyData],
  );
  const displayChartData = useMemo(
    () => filterChartRowsByWindow(chartData, deferredT, windowSeconds),
    [chartData, deferredT, windowSeconds],
  );

  const currentXAxisCategory = displayChartData.length
    ? (displayChartData.find((point) => t / 3600 <= point.hour) ?? displayChartData[displayChartData.length - 1]).time
    : undefined;
  const currentCount = displayChartData.length
    ? (displayChartData.find((point) => t / 3600 <= point.hour) ?? displayChartData[displayChartData.length - 1]).count
    : 0;

  const currentAnchorCapacity = useMemo(() => {
    if (!occupancyData || !Number.isFinite(timeBinMinutes) || timeBinMinutes <= 0) {
      return undefined;
    }
    const minutesPerDay = 24 * 60;
    const totalMinutes = Math.floor(t / 60) % minutesPerDay;
    const binStartMinutes = totalMinutes - (totalMinutes % timeBinMinutes);
    const hours = Math.floor(binStartMinutes / 60);
    const minutes = binStartMinutes % 60;
    const anchorKey = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    const hourKey = `${hours.toString().padStart(2, "0")}:00-${(hours + 1).toString().padStart(2, "0")}:00`;
    const value = occupancyData.anchor_capacity?.[anchorKey] ?? occupancyData.hourly_capacity?.[hourKey];
    const normalized = normalizeCapacity(value);
    return typeof normalized === "number" ? normalized : undefined;
  }, [occupancyData, t, timeBinMinutes]);

  const windowCapacityLabel = useMemo(() => {
    const values = displayChartData
      .map((point) =>
        typeof point.capacity === "number" && Number.isFinite(point.capacity) ? point.capacity : null,
      )
      .filter((value): value is number => value !== null);
    if (!values.length) return null;
    return `${Math.round(Math.min(...values))}-${Math.round(Math.max(...values))}`;
  }, [displayChartData]);

  const trafficOverloadSegments = useMemo(() => {
    if (!displayChartData.length) {
      return { data: [], fromTime: undefined as string | undefined, toTime: undefined as string | undefined };
    }

    let firstStart: string | undefined;
    let lastEnd: string | undefined;
    const data = displayChartData.map((point) => {
      const [rawStart = "", rawEnd = ""] = point.time.split("-");
      const start = rawStart.trim();
      const end = rawEnd.trim();
      if (!firstStart && start) firstStart = start;
      if (end) lastEnd = end;

      const occupancy = Number(point.count ?? 0);
      const capacity = Number(point.capacity ?? 0);
      let color = "#34d399";
      if (capacity <= 0) {
        color = "#94a3b8";
      } else {
        color = resolveHotspotColor({
          traffic_volume_id: trafficVolumeId,
          hourly_occupancy: occupancy,
          hourly_capacity: capacity,
        }, hotspotSettings) ?? "#34d399";
      }

      return {
        period: point.time,
        color,
        metadata: [
          `Rolling occupancy: ${Math.round(occupancy)}`,
          capacity > 0 ? `Anchor capacity: ${Math.round(capacity)}` : "Anchor capacity unavailable",
        ],
        label: trafficVolumeId,
      };
    });

    return { data, fromTime: firstStart, toTime: lastEnd };
  }, [displayChartData, hotspotSettings, trafficVolumeId]);

  return (
    <div className="flex w-full shrink-0 flex-col rounded-2xl border border-white/20 bg-white/20 text-white shadow-xl backdrop-blur-md">
      <div className="flex items-start justify-between gap-3 border-b border-white/15 p-4">
        <div className="min-w-0">
          <h2 className="font-semibold">Traffic Volume Focus</h2>
          {loading ? (
            <ShimmeringText
              text={trafficVolumeId}
              className="mt-1 break-all text-lg font-semibold"
              theme={shimmerTheme}
            />
          ) : (
            <p className="mt-1 break-all text-lg font-semibold">{trafficVolumeId}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/75">
            <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5">
              Window {interestWindowLength}
            </span>
            {flightLevelRange && (
              <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5">
                FL {flightLevelRange}
              </span>
            )}
            {capacityRangeLabel && (
              <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5">
                Cap {capacityRangeLabel}
              </span>
            )}
          </div>
        </div>
        <PanelCloseButton onClick={onClear} title="Clear traffic volume focus" />
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          <SummaryCard label="Current Load" value={Math.round(Number(currentCount ?? 0))} />
          <SummaryCard label="Anchor Capacity" value={typeof currentAnchorCapacity === "number" ? Math.round(currentAnchorCapacity) : "N/A"} />
          <SummaryCard label="Window Cap Range" value={windowCapacityLabel ?? "N/A"} />
          <SummaryCard
            label="Flights In TV"
            value={occupancyData?.metadata?.total_flights_in_tv ?? "N/A"}
          />
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <h4 className="font-medium text-sm opacity-90">Interest Window Length</h4>
          <div className="grid grid-cols-4 gap-2">
            {WINDOW_LENGTH_OPTIONS.map((duration) => (
              <button
                key={duration}
                type="button"
                onClick={() => onInterestWindowLengthChange(duration)}
                className={`px-3 py-2 text-xs font-medium rounded-md backdrop-blur-sm border transition-all duration-200 ${
                  interestWindowLength === duration
                    ? "bg-blue-500/30 border-blue-400/50 text-blue-200"
                    : "bg-white/10 border-white/20 text-white/80 hover:bg-white/15 hover:border-white/30"
                }`}
              >
                {duration}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-white/70">
            <div className="h-5 w-5 animate-spin rounded-full border border-white/20 border-t-white/80" />
            <ShimmeringText text="Loading traffic volume context..." className="ml-2 text-sm font-normal text-white/70" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-300/30 bg-red-500/10 px-3 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-white/90">Occupancy Window</h3>
                <span className="text-[11px] text-white/55">
                  {displayChartData.length > 0 ? `${displayChartData.length} bins` : "No bins in scope"}
                </span>
              </div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={displayChartData}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: "#cbd5e1", fontSize: 10 }}
                      axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                      tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                      tickFormatter={(value: string) => String(value).split("-")[0] ?? value}
                    />
                    <YAxis
                      tick={{ fill: "#cbd5e1", fontSize: 10 }}
                      axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                      tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                      width={36}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" fill="#06b6d4" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    <Line
                      type="linear"
                      dataKey="capacity"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    {currentXAxisCategory && (
                      <ReferenceLine
                        x={currentXAxisCategory}
                        stroke="#ef4444"
                        strokeWidth={2}
                        label={{ value: "Now", position: "top", fill: "#ef4444", fontSize: 10 }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {trafficOverloadSegments.data.length > 0 && (
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="mb-3 text-sm font-medium text-white/90">Load Severity</div>
                <TrafficOverloadBar
                  fromTime={trafficOverloadSegments.fromTime}
                  toTime={trafficOverloadSegments.toTime}
                  data={trafficOverloadSegments.data}
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

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-[11px] uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white/90">{value}</div>
    </div>
  );
}
