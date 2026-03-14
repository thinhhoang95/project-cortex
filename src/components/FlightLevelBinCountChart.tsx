"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import {
  aggregateFlightLevelBins,
  filterFlightLevelBinsToWindow,
  type AggregatedFlightLevelBin,
  type FlightLevelBinSizeFeet,
  type FlightLevelCountsPayload,
} from "@/lib/flightLevelBinCounts";

const MODE_OPTIONS: Array<{ label: string; value: FlightLevelBinSizeFeet }> = [
  { label: "Separated by 1000ft", value: 1000 },
  { label: "Separated by 2000ft", value: 2000 },
  { label: "Separated by 3000ft", value: 3000 },
  { label: "Separated by 5000ft", value: 5000 },
];

function FlightLevelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { label: string; count: number } }>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div className="rounded-lg border border-white/20 bg-slate-800/90 p-2 text-xs text-white backdrop-blur-sm">
      <p className="font-medium">{row.label}</p>
      <p>Distinct flights: {row.count}</p>
    </div>
  );
}

export default function FlightLevelBinCountChart({
  data,
  trafficVolumeId,
  filterToWindow = false,
  windowStartSeconds,
  windowSeconds,
}: {
  data?: FlightLevelCountsPayload | null;
  trafficVolumeId?: string | null;
  filterToWindow?: boolean;
  windowStartSeconds?: number;
  windowSeconds?: number;
}) {
  const [binSizeFeet, setBinSizeFeet] = useState<FlightLevelBinSizeFeet>(1000);
  const selectId = useId();
  const setFlightLinePreviewFlightIds = useSimStore((state) => state.setFlightLinePreviewFlightIds);
  const previewCacheRef = useRef<Map<string, string[]>>(new Map());
  const hoverRequestSeq = useRef(0);
  const activePreviewKeyRef = useRef<string | null>(null);
  const [hoveredBinKey, setHoveredBinKey] = useState<string | null>(null);

  const chartData = useMemo(() => {
    if (!data?.bins?.length) return [];

    const scopedBins =
      filterToWindow && typeof windowStartSeconds === "number" && typeof windowSeconds === "number"
        ? filterFlightLevelBinsToWindow({
            bins: data.bins,
            windowStartSeconds,
            windowSeconds,
          })
        : data.bins;

    return aggregateFlightLevelBins({
      bins: scopedBins,
      binSizeFeet,
      rangeStartFl: 0,
      rangeEndFl: data.metadata?.max_fl,
      includeEmpty: false,
    }).reverse();
  }, [data, binSizeFeet, filterToWindow, windowStartSeconds, windowSeconds]);

  const chartHeight = Math.max(240, chartData.length * 16);
  const previewWindow = useMemo(() => {
    if (!trafficVolumeId) return null;
    if (
      filterToWindow &&
      typeof windowStartSeconds === "number" &&
      typeof windowSeconds === "number" &&
      Number.isFinite(windowStartSeconds) &&
      Number.isFinite(windowSeconds) &&
      windowSeconds > 0
    ) {
      return {
        refTimeStr: formatClockTime(windowStartSeconds),
        durationMin: Math.max(1, Math.ceil(windowSeconds / 60)),
      };
    }
    return {
      refTimeStr: "00:00:00",
      durationMin: 24 * 60,
    };
  }, [trafficVolumeId, filterToWindow, windowStartSeconds, windowSeconds]);

  const clearPreview = useCallback(() => {
    activePreviewKeyRef.current = null;
    hoverRequestSeq.current += 1;
    setHoveredBinKey(null);
    setFlightLinePreviewFlightIds(new Set());
  }, [setFlightLinePreviewFlightIds]);

  useEffect(() => clearPreview, [clearPreview]);
  useEffect(() => {
    clearPreview();
  }, [binSizeFeet, previewWindow?.refTimeStr, previewWindow?.durationMin, trafficVolumeId, clearPreview]);

  const previewBin = useCallback(async (row: AggregatedFlightLevelBin | null | undefined) => {
    if (!row || !trafficVolumeId || !previewWindow || row.count <= 0) {
      clearPreview();
      return;
    }

    const cacheKey = [
      trafficVolumeId,
      previewWindow.refTimeStr,
      previewWindow.durationMin,
      row.startFl,
      row.endFl,
    ].join("|");

    activePreviewKeyRef.current = cacheKey;
    setHoveredBinKey(row.key);

    const cachedIds = previewCacheRef.current.get(cacheKey);
    if (cachedIds) {
      setFlightLinePreviewFlightIds(new Set(cachedIds));
      return;
    }

    setFlightLinePreviewFlightIds(new Set());
    const reqId = ++hoverRequestSeq.current;

    try {
      const params = new URLSearchParams({
        traffic_volume_id: trafficVolumeId,
        ref_time_str: previewWindow.refTimeStr,
        start_fl: String(row.startFl),
        end_fl: String(row.endFl),
        duration_min: String(previewWindow.durationMin),
      });
      const response = await authFetch(`/api/tv_flight_level_bin_flights?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch flight preview (${response.status})`);
      }

      const payload = await response.json().catch(() => ({}));
      const flightIds = Array.isArray(payload?.flight_ids)
        ? payload.flight_ids.map((id: unknown) => String(id ?? "").trim()).filter(Boolean)
        : [];

      previewCacheRef.current.set(cacheKey, flightIds);
      if (reqId !== hoverRequestSeq.current || activePreviewKeyRef.current !== cacheKey) return;
      setFlightLinePreviewFlightIds(new Set(flightIds));
    } catch {
      if (reqId !== hoverRequestSeq.current || activePreviewKeyRef.current !== cacheKey) return;
      setFlightLinePreviewFlightIds(new Set());
    }
  }, [clearPreview, previewWindow, setFlightLinePreviewFlightIds, trafficVolumeId]);

  const handleBarEnter = useCallback((entry: { payload?: AggregatedFlightLevelBin } | null | undefined) => {
    void previewBin(entry?.payload);
  }, [previewBin]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white/90">FL Distribution</h4>
        </div>

        <select
          id={selectId}
          value={binSizeFeet}
          onChange={(event) => setBinSizeFeet(Number(event.target.value) as FlightLevelBinSizeFeet)}
          className="min-w-[180px] rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/85 outline-none transition-colors focus:border-white/20 focus:bg-white/10"
        >
          {MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {chartData.length > 0 ? (
        <div className="mt-4 max-h-[420px] overflow-y-auto pr-1">
          <div style={{ width: "100%", height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 0, right: 16, left: 12, bottom: 0 }}
                barCategoryGap={2}
                onMouseLeave={clearPreview}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fill: "#e2e8f0", fontSize: 11 }}
                  axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={78}
                  tick={{ fill: "#e2e8f0", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <Tooltip content={<FlightLevelTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Bar
                  dataKey="count"
                  fill="#38bdf8"
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={false}
                  barSize={12}
                  onMouseEnter={handleBarEnter}
                >
                  {chartData.map((row) => (
                    <Cell
                      key={row.key}
                      fill={hoveredBinKey === row.key ? "#67e8f9" : "#38bdf8"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-sm text-white/70">
          No flight-level count data is available for the selected traffic volume.
        </div>
      )}
    </div>
  );
}

function formatClockTime(totalSeconds: number) {
  const secondsPerDay = 24 * 3600;
  const normalized = ((Math.floor(totalSeconds) % secondsPerDay) + secondsPerDay) % secondsPerDay;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const seconds = normalized % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}
