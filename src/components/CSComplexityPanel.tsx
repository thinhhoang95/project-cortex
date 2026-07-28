"use client";

import { LocateFixed } from "lucide-react";
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

import ComplexityDensityRuler from "@/components/ComplexityDensityRuler";
import PanelCloseButton from "@/components/PanelCloseButton";
import ShimmeringText from "@/components/ShimmeringText";
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import {
  buildComplexityContextDensityRulerModel,
  buildComplexityChartRows,
  COMPLEXITY_INTEREST_WINDOWS,
  COMPLEXITY_METRIC_IDS,
  COMPLEXITY_METRIC_META,
  getComplexityMetricSpatialContext,
  getComplexityContextSlot,
  getClosestSnapshot,
  getInterestWindowSeconds,
  hasComplexityContextSpatialData,
  sumMetricCounts,
  type ComplexityContextResponse,
  type ComplexityMetricId,
  type ComplexitySuiteResponse,
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
  contextData: ComplexityContextResponse | null;
  contextLoading: boolean;
  contextError: string | null;
  showContextMapOverlay: boolean;
  onShowContextMapOverlayChange: (value: boolean) => void;
  onClear: () => void;
};

function formatContextNumber(value: number | null | undefined): string {
  const next = Number(value);
  if (!Number.isFinite(next)) return "—";
  if (Math.abs(next) >= 100 || Number.isInteger(next)) return String(Math.round(next));
  return next.toFixed(1);
}

function formatTailProbability(value: number | null | undefined): string {
  const next = Number(value);
  if (!Number.isFinite(next)) return "—";
  if (next < 0.001) return "<0.001";
  return next.toFixed(3);
}

function tailProbabilityTone(value: number | null | undefined): string {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return "border-white/10 bg-white/5 text-white/55";
  }
  if (next <= 0.05) {
    return "border-red-400/40 bg-red-500/15 text-red-100";
  }
  if (next <= 0.1) {
    return "border-orange-400/40 bg-orange-500/15 text-orange-100";
  }
  if (next <= 0.2) {
    return "border-yellow-300/40 bg-yellow-400/15 text-yellow-100";
  }
  return "border-white/10 bg-white/5 text-white/70";
}

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
  contextData,
  contextLoading,
  contextError,
  showContextMapOverlay,
  onShowContextMapOverlayChange,
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
  const showHistoryChart = interestWindowLength !== "2m";
  const forwardWindowLabel = `${formatSecondsToHHMMSS(t)}-${formatSecondsToHHMMSS(
    Math.min(24 * 60 * 60 - 1, t + getInterestWindowSeconds(interestWindowLength)),
  )}`;
  const contextSlot = useMemo(() => getComplexityContextSlot(contextData?.slots, t), [contextData?.slots, t]);
  const contextSlotLabel = useMemo(() => {
    if (typeof contextSlot?.time_bin === "string" && contextSlot.time_bin.trim()) {
      return contextSlot.time_bin;
    }
    if (!contextSlot) return null;
    return `${contextSlot.slot_start_time}-${contextSlot.slot_end_time}`;
  }, [contextSlot]);
  const selectedMetricSpatialContext = getComplexityMetricSpatialContext(contextSlot, selectedMetric);
  const selectedMetricHasSpatialContext = hasComplexityContextSpatialData(
    selectedMetric,
    selectedMetricSpatialContext,
  );
  const contextRows = useMemo(
    () =>
      COMPLEXITY_METRIC_IDS.map((metricId) => {
        const contextMetric = contextSlot?.metrics?.[metricId] ?? null;
        return {
          metricId,
          contextMetric,
          rulerModel: buildComplexityContextDensityRulerModel(contextMetric),
        };
      }),
    [contextSlot],
  );

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

  const renderContextSection = () => (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Best Knowledge Context</h3>
          </div>
          <p className="text-xs text-white/65">
            {contextSlotLabel ? `Current slot ${contextSlotLabel}` : "Current 30-minute slot"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onShowContextMapOverlayChange(!showContextMapOverlay)}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            showContextMapOverlay
              ? "border-red-300/35 bg-red-500/15 text-red-50"
              : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
          }`}
        >
          2D Map {showContextMapOverlay ? "On" : "Off"}
        </button>
      </div>

      <p className="text-xs text-white/55">
        Marker shows the current 30-minute observed value.
      </p>

      {showContextMapOverlay && selectedMetric === "td" && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65">
          2D spatial best knowledge is unavailable for Traffic Density.
        </p>
      )}

      {showContextMapOverlay &&
        selectedMetric !== "td" &&
        Boolean(contextSlot) &&
        !selectedMetricHasSpatialContext &&
        !contextLoading &&
        !contextError && (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65">
          2D spatial context is unavailable for {COMPLEXITY_METRIC_META[selectedMetric].label} in this slot.
        </p>
      )}

      {contextLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-white/25 border-t-white" />
          <ShimmeringText text="Loading best-knowledge context..." className="ml-2 text-sm opacity-80 font-normal" />
        </div>
      ) : contextError ? (
        <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4">
          <p className="text-sm text-red-200">{contextError}</p>
        </div>
      ) : !contextSlot ? (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs text-white/65">
          No best-knowledge context was returned for the current 30-minute slot.
        </div>
      ) : (
        <div className="space-y-3">
          {contextRows.map(({ metricId, contextMetric, rulerModel }) => {
            const meta = COMPLEXITY_METRIC_META[metricId];
            const isActive = metricId === selectedMetric;
            const showRuler =
              Boolean(contextMetric?.distribution_available) &&
              Boolean(rulerModel) &&
              (rulerModel?.samples.length ?? 0) > 0;
            return (
              <div
                key={metricId}
                className={`rounded-xl border px-3 py-2 ${
                  isActive ? "border-white/25 bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]" : "border-white/10 bg-white/4"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{meta.label}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tailProbabilityTone(
                      contextMetric?.upper_tail_probability,
                    )}`}
                  >
                    p↑ {formatTailProbability(contextMetric?.upper_tail_probability)}
                  </span>
                </div>

                {showRuler ? (
                  <ComplexityDensityRuler model={rulerModel} active={isActive} className="mt-2" />
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-white/12 bg-white/4 px-3 py-3 text-xs text-white/55">
                    No best-knowledge comparison is available for this metric in this slot.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

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
                <LocateFixed width="18" height="18" strokeWidth="2" className="mb-1" />
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

                {renderContextSection()}

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

            {(suiteLoading || suiteError) && renderContextSection()}
          </>
        )}
      </div>
    </div>
  );
}
