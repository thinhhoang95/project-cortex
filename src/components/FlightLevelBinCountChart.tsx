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
import { createLatestOnlyAsyncQueue } from "@/lib/latestOnlyAsyncQueue";
import {
  aggregateFlightLevelBins,
  filterFlightLevelBinsToWindow,
  type AggregatedFlightLevelBin,
  type FlightLevelBinPreviewSegment,
  type FlightLevelBinSizeFeet,
  type FlightLevelCountsPayload,
  mergeFlightLevelBinPreviewSegments,
  normalizeFlightLevelBinPreviewSegments,
} from "@/lib/flightLevelBinCounts";

const MODE_OPTIONS: Array<{ label: string; value: FlightLevelBinSizeFeet }> = [
  { label: "Separated by 1000ft", value: 1000 },
  { label: "Separated by 2000ft", value: 2000 },
  { label: "Separated by 3000ft", value: 3000 },
  { label: "Separated by 5000ft", value: 5000 },
];

export function buildFlightLevelPreviewCacheKey(args: {
  resourceStateEpoch: number;
  trafficVolumeId: string;
  refTimeStr: string;
  durationMin: number;
  startFl: number;
  endFl: number;
}): string {
  return [
    args.resourceStateEpoch,
    args.trafficVolumeId,
    args.refTimeStr,
    args.durationMin,
    args.startFl,
    args.endFl,
  ].join("|");
}

export function deriveNextFlightLevelSelectedBinKeys(args: {
  currentKeys: string[];
  clickedKey: string;
  multiselect: boolean;
}): string[] {
  const clickedKey = String(args.clickedKey ?? "").trim();
  if (!clickedKey) return args.currentKeys;
  if (!args.multiselect) {
    return [clickedKey];
  }
  return args.currentKeys.includes(clickedKey)
    ? args.currentKeys
    : [...args.currentKeys, clickedKey];
}

type PreviewRequest = {
  cacheKey: string;
  trafficVolumeId: string;
  refTimeStr: string;
  durationMin: number;
  startFl: number;
  endFl: number;
};

type PreviewIntent = {
  token: string;
  requests: PreviewRequest[];
};

type ModifierAwareEvent = {
  ctrlKey?: boolean;
  metaKey?: boolean;
  nativeEvent?: {
    ctrlKey?: boolean;
    metaKey?: boolean;
  };
};

function isMultiSelectEvent(event: ModifierAwareEvent | null | undefined): boolean {
  if (!event) return false;
  return Boolean(
    event.ctrlKey ||
    event.metaKey ||
    event.nativeEvent?.ctrlKey ||
    event.nativeEvent?.metaKey,
  );
}

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
  const resourceStateEpoch = useSimStore((state) => state.resourceStateEpoch);
  const setFlightLevelBinPreviewSegments = useSimStore((state) => state.setFlightLevelBinPreviewSegments);
  const clearFlightLevelBinPreviewSegments = useSimStore((state) => state.clearFlightLevelBinPreviewSegments);
  const previewCacheRef = useRef<Map<string, FlightLevelBinPreviewSegment[]>>(new Map());
  const hoverRequestSeq = useRef(0);
  const activePreviewKeyRef = useRef<string | null>(null);
  const previewRequestQueueRef = useRef<ReturnType<typeof createLatestOnlyAsyncQueue<PreviewIntent>> | null>(null);
  const [hoveredBinKey, setHoveredBinKey] = useState<string | null>(null);
  const [selectedBinKeys, setSelectedBinKeys] = useState<string[]>([]);

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
  const selectedBinKeySet = useMemo(() => new Set(selectedBinKeys), [selectedBinKeys]);
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
    previewRequestQueueRef.current?.clear();
    setHoveredBinKey(null);
    clearFlightLevelBinPreviewSegments();
  }, [clearFlightLevelBinPreviewSegments]);

  const processPreviewRequest = useCallback(async (intent: PreviewIntent) => {
    const reqId = ++hoverRequestSeq.current;
    const segmentGroups: FlightLevelBinPreviewSegment[][] = [];

    for (const request of intent.requests) {
      let previewSegments = previewCacheRef.current.get(request.cacheKey);

      if (!previewSegments) {
        try {
          const params = new URLSearchParams({
            traffic_volume_id: request.trafficVolumeId,
            ref_time_str: request.refTimeStr,
            start_fl: String(request.startFl),
            end_fl: String(request.endFl),
            duration_min: String(request.durationMin),
          });
          const response = await authFetch(`/api/tv_flight_level_bin_flights?${params.toString()}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch flight preview (${response.status})`);
          }

          const payload = await response.json().catch(() => ({}));
          previewSegments = normalizeFlightLevelBinPreviewSegments(payload);
          previewCacheRef.current.set(request.cacheKey, previewSegments);
        } catch {
          if (reqId !== hoverRequestSeq.current || activePreviewKeyRef.current !== intent.token) return;
          continue;
        }
      }

      segmentGroups.push(previewSegments);
      if (reqId !== hoverRequestSeq.current || activePreviewKeyRef.current !== intent.token) return;
    }

    if (reqId !== hoverRequestSeq.current || activePreviewKeyRef.current !== intent.token) return;
    const mergedSegments = mergeFlightLevelBinPreviewSegments(segmentGroups);
    if (mergedSegments.length > 0) {
      setFlightLevelBinPreviewSegments(mergedSegments);
    } else {
      clearFlightLevelBinPreviewSegments();
    }
  }, [clearFlightLevelBinPreviewSegments, setFlightLevelBinPreviewSegments]);

  useEffect(() => {
    const queue = createLatestOnlyAsyncQueue(processPreviewRequest);
    previewRequestQueueRef.current = queue;
    return () => {
      if (previewRequestQueueRef.current === queue) {
        previewRequestQueueRef.current = null;
      }
      queue.dispose();
    };
  }, [processPreviewRequest]);

  useEffect(() => clearPreview, [clearPreview]);
  useEffect(() => {
    previewCacheRef.current.clear();
    setSelectedBinKeys([]);
    clearPreview();
  }, [
    binSizeFeet,
    previewWindow?.refTimeStr,
    previewWindow?.durationMin,
    resourceStateEpoch,
    trafficVolumeId,
    clearPreview,
  ]);

  const buildPreviewRequest = useCallback((row: AggregatedFlightLevelBin | null | undefined): PreviewRequest | null => {
    if (!row || !trafficVolumeId || !previewWindow || row.count <= 0) {
      return null;
    }

    return {
      cacheKey: buildFlightLevelPreviewCacheKey({
        resourceStateEpoch,
        trafficVolumeId,
        refTimeStr: previewWindow.refTimeStr,
        durationMin: previewWindow.durationMin,
        startFl: row.startFl,
        endFl: row.endFl,
      }),
      trafficVolumeId,
      refTimeStr: previewWindow.refTimeStr,
      durationMin: previewWindow.durationMin,
      startFl: row.startFl,
      endFl: row.endFl,
    };
  }, [previewWindow, resourceStateEpoch, trafficVolumeId]);

  const activatePreviewRequests = useCallback((requests: PreviewRequest[], token: string) => {
    activePreviewKeyRef.current = token;
    previewRequestQueueRef.current?.clear();

    const cachedSegmentGroups = requests
      .map((request) => previewCacheRef.current.get(request.cacheKey))
      .filter((segments): segments is FlightLevelBinPreviewSegment[] => Array.isArray(segments));
    const cachedSegments = mergeFlightLevelBinPreviewSegments(cachedSegmentGroups);

    if (cachedSegments.length > 0) {
      setFlightLevelBinPreviewSegments(cachedSegments);
    } else {
      clearFlightLevelBinPreviewSegments();
    }

    const missingRequests = requests.filter((request) => !previewCacheRef.current.has(request.cacheKey));
    if (missingRequests.length > 0) {
      previewRequestQueueRef.current?.enqueue({
        token,
        requests,
      });
    }
  }, [clearFlightLevelBinPreviewSegments, setFlightLevelBinPreviewSegments]);

  const previewBin = useCallback((row: AggregatedFlightLevelBin | null | undefined) => {
    const request = buildPreviewRequest(row);
    if (!request) {
      clearPreview();
      return;
    }

    setHoveredBinKey(row?.key ?? null);
    activatePreviewRequests([request], request.cacheKey);
  }, [activatePreviewRequests, buildPreviewRequest, clearPreview]);

  useEffect(() => {
    if (selectedBinKeys.length === 0) return;

    const selectedRows = selectedBinKeys
      .map((key) => chartData.find((row) => row.key === key) ?? null)
      .filter((row): row is AggregatedFlightLevelBin => row !== null);

    if (selectedRows.length !== selectedBinKeys.length) {
      const normalizedKeys = selectedRows.map((row) => row.key);
      setSelectedBinKeys(normalizedKeys);
      if (normalizedKeys.length === 0) {
        clearPreview();
        return;
      }
    }

    const requests = selectedRows
      .map((row) => buildPreviewRequest(row))
      .filter((request): request is PreviewRequest => request !== null);

    if (requests.length === 0) {
      clearPreview();
      return;
    }

    setHoveredBinKey(null);
    activatePreviewRequests(
      requests,
      requests.map((request) => request.cacheKey).join("||"),
    );
  }, [activatePreviewRequests, buildPreviewRequest, chartData, clearPreview, selectedBinKeys]);

  const resetSelection = useCallback(() => {
    setSelectedBinKeys([]);
    clearPreview();
  }, [clearPreview]);

  const handleBarEnter = useCallback((entry: { payload?: AggregatedFlightLevelBin } | null | undefined) => {
    if (selectedBinKeys.length > 0) return;
    previewBin(entry?.payload);
  }, [previewBin, selectedBinKeys.length]);

  const handleBarClick = useCallback((
    entry: { payload?: AggregatedFlightLevelBin } | null | undefined,
    _index: number,
    event: ModifierAwareEvent | undefined,
  ) => {
    const row = entry?.payload;
    if (!row || row.count <= 0) return;

    setSelectedBinKeys((currentKeys) =>
      deriveNextFlightLevelSelectedBinKeys({
        currentKeys,
        clickedKey: row.key,
        multiselect: isMultiSelectEvent(event),
      }),
    );
  }, []);

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
                onMouseLeave={() => {
                  if (selectedBinKeys.length === 0) {
                    clearPreview();
                  }
                }}
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
                  onClick={handleBarClick}
                  style={{ cursor: "pointer" }}
                >
                  {chartData.map((row) => (
                    <Cell
                      key={row.key}
                      fill={
                        selectedBinKeySet.has(row.key)
                          ? "#22c55e"
                          : hoveredBinKey === row.key
                            ? "#67e8f9"
                            : "#38bdf8"
                      }
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

      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <div className="text-white/60">
          {selectedBinKeys.length > 0
            ? `${selectedBinKeys.length} bin${selectedBinKeys.length === 1 ? "" : "s"} selected`
            : "Hover to preview segments. Ctrl-click to union bins."}
        </div>
        <button
          type="button"
          onClick={resetSelection}
          disabled={selectedBinKeys.length === 0}
          className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-white/85 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset
        </button>
      </div>
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
