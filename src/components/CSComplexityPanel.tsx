"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import PanelCloseButton from "@/components/PanelCloseButton";
import ShimmeringText from "@/components/ShimmeringText";
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import {
  buildComplexityChartRows,
  COMPLEXITY_INTEREST_WINDOWS,
  COMPLEXITY_METRIC_IDS,
  COMPLEXITY_METRIC_META,
  getComplexityMetricSelectionLabel,
  getClosestSnapshot,
  getInterestWindowSeconds,
  mergeTraceEnvelopes,
  sumMetricCounts,
  type ComplexityMetricId,
  type ComplexitySuiteResponse,
  type ComplexityTraceResponse,
} from "@/lib/csComplexity";
import { formatSecondsToHHMMSS } from "@/lib/time";
import { formatFlightLevelRange } from "@/lib/trafficVolumeFormat";

type OrderedSectorFlightsData = {
  elementary_sector_id: string;
  ref_time_str: string;
  ordered_flights: string[];
  details: {
    flight_id: string;
    arrival_time: string;
    arrival_seconds: number;
    delta_seconds: number;
    time_window: string;
    dwell_seconds?: number | null;
  }[];
};

type CSComplexityPanelProps = {
  interestWindowLength: string;
  onInterestWindowLengthChange: (value: string) => void;
  selectedMetric: ComplexityMetricId;
  onSelectedMetricChange: (metricId: ComplexityMetricId) => void;
  suiteData: ComplexitySuiteResponse | null;
  suiteLoading: boolean;
  suiteError: string | null;
  traceData: ComplexityTraceResponse | null;
  traceLoading: boolean;
  traceError: string | null;
  onClear: () => void;
};

function formatTimeForAPI(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return `${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}${String(secs).padStart(2, "0")}`;
}

export default function CSComplexityPanel({
  interestWindowLength,
  onInterestWindowLengthChange,
  selectedMetric,
  onSelectedMetricChange,
  suiteData,
  suiteLoading,
  suiteError,
  traceData,
  traceLoading,
  traceError,
  onClear,
}: CSComplexityPanelProps) {
  const {
    selectedCollapsedSector,
    selectedCollapsedSectorData,
    resourceStateEpoch,
    t,
    focusMode,
    setFocusMode,
    setFocusFlightIds,
  } = useSimStore();

  const [sectorFlightsData, setSectorFlightsData] = useState<OrderedSectorFlightsData | null>(null);
  const [flightLoading, setFlightLoading] = useState(false);
  const [flightError, setFlightError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCollapsedSector) {
      setSectorFlightsData(null);
      setFlightError(null);
      return;
    }

    let cancelled = false;
    const fetchSectorFlights = async () => {
      setFlightLoading(true);
      setFlightError(null);
      try {
        const response = await authFetch(
          `/api/sector_flights?elementary_sector_id=${encodeURIComponent(selectedCollapsedSector)}&ref_time_str=${encodeURIComponent(formatTimeForAPI(t))}`,
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(errorData.error || `Failed to fetch sector flights (${response.status})`);
        }

        const data = (await response.json()) as OrderedSectorFlightsData;
        if (!cancelled) {
          setSectorFlightsData(data);
        }
      } catch (error) {
        if (!cancelled) {
          setSectorFlightsData(null);
          setFlightError(error instanceof Error ? error.message : "Failed to fetch sector flights");
        }
      } finally {
        if (!cancelled) {
          setFlightLoading(false);
        }
      }
    };

    fetchSectorFlights();
    return () => {
      cancelled = true;
    };
  }, [resourceStateEpoch, selectedCollapsedSector, t]);

  const chartRows = useMemo(() => buildComplexityChartRows(suiteData?.snapshots), [suiteData?.snapshots]);
  const currentSnapshot = useMemo(
    () => getClosestSnapshot(suiteData?.snapshots, t),
    [suiteData?.snapshots, t],
  );
  const mergedTraceEnvelope = useMemo(
    () => mergeTraceEnvelopes(traceData?.snapshots, selectedMetric),
    [selectedMetric, traceData?.snapshots],
  );
  const showHistoryChart = interestWindowLength !== "2m";
  const forwardWindowLabel = `${formatSecondsToHHMMSS(t)}-${formatSecondsToHHMMSS(
    Math.min(24 * 60 * 60 - 1, t + getInterestWindowSeconds(interestWindowLength)),
  )}`;

  const filteredFlightIds = useMemo(() => {
    if (!sectorFlightsData) return new Set<string>();
    const windowEnd = t + getInterestWindowSeconds(interestWindowLength);
    const next = new Set<string>();
    for (const detail of sectorFlightsData.details) {
      if (detail.arrival_seconds >= t && detail.arrival_seconds <= windowEnd) {
        next.add(String(detail.flight_id));
      }
    }
    return next;
  }, [interestWindowLength, sectorFlightsData, t]);

  useEffect(() => {
    if (!selectedCollapsedSector) {
      setFocusMode(false);
      setFocusFlightIds(new Set<string>());
      return;
    }
    if (!focusMode) {
      setFocusFlightIds(new Set<string>());
      return;
    }
    setFocusFlightIds(filteredFlightIds);
  }, [filteredFlightIds, focusMode, selectedCollapsedSector, setFocusFlightIds, setFocusMode]);

  useEffect(() => {
    setFlightError(null);
  }, [selectedCollapsedSector]);

  const flightLevelRange = formatFlightLevelRange(
    selectedCollapsedSectorData?.properties?.min_fl,
    selectedCollapsedSectorData?.properties?.max_fl,
  );

  const traceSummary =
    mergedTraceEnvelope && typeof mergedTraceEnvelope.returned_record_count === "number"
      ? `${mergedTraceEnvelope.returned_record_count} record${mergedTraceEnvelope.returned_record_count === 1 ? "" : "s"}`
      : null;

  return (
    <div className="w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-white/20">
        <div>
          <h2 className="font-semibold">Collapsed Sector Complexity</h2>
          <p className="text-xs text-white/65">{forwardWindowLabel}</p>
        </div>
        <PanelCloseButton onClick={onClear} title="Close complexity panel" />
      </div>

      <div className="p-4 space-y-4">
        {!selectedCollapsedSector ? (
          <div className="py-2" />
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-white/15 pb-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/65">Selected Collapsed Sector</p>
                <p className="text-xl font-semibold">{selectedCollapsedSector}</p>
                {flightLevelRange && <p className="text-xs text-white/65 mt-1">{flightLevelRange}</p>}
              </div>
              <button
                type="button"
                onClick={() => setFocusMode(!focusMode)}
                className={`flex flex-col items-center px-3 py-2 rounded-lg backdrop-blur-sm border transition-all duration-200 min-w-[70px] ${
                  focusMode
                    ? "bg-blue-500/30 border-blue-400/50 text-blue-200"
                    : "bg-white/10 border-white/20 text-white/80 hover:bg-white/15 hover:border-white/30"
                }`}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mb-1"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="3" />
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                </svg>
                <span className="text-xs font-medium">Focus</span>
              </button>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">Interest Window</h3>
                {focusMode && (
                  <p className="text-xs text-white/65">
                    {flightLoading ? "Refreshing sector flights..." : `${filteredFlightIds.size} focused flights`}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {COMPLEXITY_INTEREST_WINDOWS.map((windowLength) => (
                  <button
                    key={windowLength}
                    type="button"
                    onClick={() => onInterestWindowLengthChange(windowLength)}
                    className={`px-3 py-2 text-xs font-medium rounded-md border transition-colors ${
                      interestWindowLength === windowLength
                        ? "bg-blue-500/25 border-blue-300/50 text-blue-100"
                        : "bg-white/10 border-white/20 text-white/80 hover:bg-white/15"
                    }`}
                  >
                    {windowLength}
                  </button>
                ))}
              </div>
              {flightError && <p className="text-xs text-red-200">{flightError}</p>}
            </div>

            {suiteLoading ? (
              <div className="flex items-center justify-center py-10">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/25 border-t-white" />
                <ShimmeringText text="Loading complexity suite..." className="ml-2 text-sm opacity-80 font-normal" />
              </div>
            ) : suiteError ? (
              <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4">
                <p className="text-sm text-red-200">{suiteError}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                  {COMPLEXITY_METRIC_IDS.map((metricId) => {
                    const meta = COMPLEXITY_METRIC_META[metricId];
                    const count = sumMetricCounts(suiteData?.snapshots, metricId);
                    const active = selectedMetric === metricId;
                    return (
                      <button
                        key={metricId}
                        type="button"
                        onClick={() => onSelectedMetricChange(metricId)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          active
                            ? "border-white/40 bg-white/15"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <p className="text-sm font-medium">{meta.label}</p>
                        <p className="text-xl font-semibold mt-2" style={{ color: meta.color }}>
                          {count}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {showHistoryChart && (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-medium">Density Evolution</h3>
                        <p className="text-xs text-white/65">
                          {currentSnapshot ? currentSnapshot.sample_end_time : "No snapshots returned"}
                        </p>
                      </div>
                    </div>

                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartRows}>
                          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                          <XAxis
                            dataKey="sampleEndTime"
                            stroke="rgba(255,255,255,0.55)"
                            tick={{ fontSize: 11 }}
                            minTickGap={16}
                          />
                          <YAxis allowDecimals={false} stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "rgba(15, 23, 42, 0.92)",
                              border: "1px solid rgba(255,255,255,0.15)",
                              borderRadius: 12,
                            }}
                            labelStyle={{ color: "#fff" }}
                            formatter={(value: number) => [value, COMPLEXITY_METRIC_META[selectedMetric].label]}
                          />
                          {currentSnapshot && (
                            <ReferenceLine
                              x={currentSnapshot.sample_end_time}
                              stroke="rgba(255,255,255,0.25)"
                              strokeDasharray="4 4"
                            />
                          )}
                          <Line
                            type="monotone"
                            dataKey={selectedMetric}
                            stroke={COMPLEXITY_METRIC_META[selectedMetric].color}
                            strokeWidth={2.5}
                            isAnimationActive={false}
                            dot={{ r: 2.5 }}
                            activeDot={{ r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
