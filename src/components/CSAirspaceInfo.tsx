"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import { formatDwellingTime } from "@/lib/dwellTime";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import { formatFlightLevelRange } from "@/lib/trafficVolumeFormat";
import HourGlass from "@/components/HourGlass";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import ShimmeringText from "@/components/ShimmeringText";

interface SectorOccupancyData {
  elementary_sector_id: string;
  occupancy_counts: Record<string, number>;
  anchor_capacity?: Record<string, number>;
  hourly_capacity?: Record<string, number>;
  metadata: {
    date?: string;
    time_bin_minutes: number;
    total_time_windows: number;
    total_flights_in_sector: number;
  };
}

interface SectorMetadataData {
  elementary_sector_id: string;
  min_fl?: number;
  max_fl?: number;
  airblock_count?: number;
  tv_count?: number;
  metadata?: {
    open_times_date?: string;
  };
}

interface ChartDataPoint {
  time: string;
  count: number;
  hour: number;
}

interface OrderedSectorFlightsData {
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
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function formatTimeForAPI(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, "0")}${minutes.toString().padStart(2, "0")}${secs.toString().padStart(2, "0")}`;
}

function getInterestWindowSeconds(windowLength: string): number {
  const numValue = parseInt(windowLength, 10);
  if (windowLength.includes("h")) {
    return numValue * 3600;
  }
  return numValue * 60;
}

function areSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export default function CSAirspaceInfo() {
  const {
    selectedCollapsedSector,
    selectedCollapsedSectorData,
    resourceDate,
    t,
    flights,
    resourceStateEpoch,
    focusMode,
    setFocusMode,
    setFocusFlightIds,
    setT,
    setFlowPreviewFlightId,
  } = useSimStore();

  const [occupancyData, setOccupancyData] = useState<SectorOccupancyData | null>(null);
  const [sectorMetadata, setSectorMetadata] = useState<SectorMetadataData | null>(null);
  const [orderedFlightsData, setOrderedFlightsData] = useState<OrderedSectorFlightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [flightListLoading, setFlightListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flightListError, setFlightListError] = useState<string | null>(null);
  const [interestWindowLength, setInterestWindowLength] = useState<string>("1h");
  const [expanded, setExpanded] = useState(false);
  const MAX_VISIBLE = 20;

  useEffect(() => {
    setOccupancyData(null);
    setOrderedFlightsData(null);
    setError(null);
    setFlightListError(null);
    setLoading(false);
    setFlightListLoading(false);
    setExpanded(false);
  }, [resourceStateEpoch]);

  const flightLevelRange = formatFlightLevelRange(
    selectedCollapsedSectorData?.properties?.min_fl ?? sectorMetadata?.min_fl,
    selectedCollapsedSectorData?.properties?.max_fl ?? sectorMetadata?.max_fl
  );

  useEffect(() => {
    return () => {
      setFlowPreviewFlightId(null);
    };
  }, [setFlowPreviewFlightId]);

  useEffect(() => {
    if (!selectedCollapsedSector) {
      setSectorMetadata(null);
      return;
    }

    let cancelled = false;
    const fetchSectorMetadata = async () => {
      setMetadataLoading(true);
      try {
        const response = await authFetch(
          `/api/sector_metadata?elementary_sector_id=${encodeURIComponent(selectedCollapsedSector)}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch sector metadata: ${response.statusText}`);
        }

        const data: SectorMetadataData = await response.json();
        if (!cancelled) {
          setSectorMetadata(data);
        }
      } catch {
        if (!cancelled) {
          setSectorMetadata(null);
        }
      } finally {
        if (!cancelled) {
          setMetadataLoading(false);
        }
      }
    };

    fetchSectorMetadata();
    return () => {
      cancelled = true;
    };
  }, [selectedCollapsedSector]);

  useEffect(() => {
    if (!selectedCollapsedSector) {
      setOccupancyData(null);
      setError(null);
      return;
    }

    const preferredDate = resourceDate;
    if (!preferredDate) {
      setError("Invalid operation date format; expected YYYY-MM-DD");
      setOccupancyData(null);
      return;
    }

    const fallbackDate = sectorMetadata?.metadata?.open_times_date;
    let cancelled = false;

    const fetchOccupancy = async () => {
      setLoading(true);
      setError(null);

      const fetchForDate = async (targetDate: string) => {
        const response = await authFetch(
          `/api/sector_count_with_capacity?elementary_sector_id=${encodeURIComponent(selectedCollapsedSector)}&date=${encodeURIComponent(targetDate)}`
        );
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          const message = (payload as any)?.error || `Failed to fetch occupancy data: ${response.statusText}`;
          const err = new Error(message) as Error & { status?: number };
          err.status = response.status;
          throw err;
        }

        return payload as SectorOccupancyData;
      };

      try {
        const data = await fetchForDate(preferredDate);
        if (!cancelled) {
          setOccupancyData(data);
        }
      } catch (firstError) {
        const shouldFallback =
          (firstError as Error & { status?: number })?.status === 404 &&
          !!fallbackDate &&
          fallbackDate !== preferredDate;

        if (shouldFallback) {
          try {
            const fallbackData = await fetchForDate(fallbackDate);
            if (!cancelled) {
              setOccupancyData(fallbackData);
              setError(null);
            }
          } catch (fallbackError) {
            if (!cancelled) {
              setError(
                fallbackError instanceof Error ? fallbackError.message : "Failed to fetch occupancy data"
              );
              setOccupancyData(null);
            }
          }
        } else if (!cancelled) {
          setError(firstError instanceof Error ? firstError.message : "Failed to fetch occupancy data");
          setOccupancyData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchOccupancy();
    return () => {
      cancelled = true;
    };
  }, [resourceDate, resourceStateEpoch, sectorMetadata?.metadata?.open_times_date, selectedCollapsedSector]);

  useEffect(() => {
    if (!selectedCollapsedSector) {
      setOrderedFlightsData(null);
      setFlightListError(null);
      return;
    }

    let cancelled = false;
    const fetchSectorFlights = async () => {
      setFlightListLoading(true);
      setFlightListError(null);
      try {
        const currentTimeStr = formatTimeForAPI(t);
        const response = await authFetch(
          `/api/sector_flights?elementary_sector_id=${encodeURIComponent(selectedCollapsedSector)}&ref_time_str=${encodeURIComponent(currentTimeStr)}`
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(errorData.error || `Failed to fetch sector flights: ${response.statusText}`);
        }

        const data = (await response.json()) as OrderedSectorFlightsData;
        if (!cancelled) {
          setOrderedFlightsData(data);
        }
      } catch (err) {
        if (!cancelled) {
          setFlightListError(err instanceof Error ? err.message : "Failed to fetch sector flights");
          setOrderedFlightsData(null);
        }
      } finally {
        if (!cancelled) {
          setFlightListLoading(false);
        }
      }
    };

    fetchSectorFlights();
    return () => {
      cancelled = true;
    };
  }, [resourceStateEpoch, selectedCollapsedSector, t]);

  const baseChartData: ChartDataPoint[] = occupancyData
    ? Object.entries(occupancyData.occupancy_counts)
        .map(([timeRange, count]) => {
          const [startTime] = timeRange.split("-");
          const [hours, minutes] = startTime.split(":").map(Number);
          const hour = hours + minutes / 60;

          return {
            time: timeRange,
            count,
            hour,
          };
        })
        .sort((a, b) => a.hour - b.hour)
    : [];

  const timeBinMinutes: number = (() => {
    if (!occupancyData || baseChartData.length === 0) return 60;
    const metaBin = occupancyData.metadata?.time_bin_minutes;
    if (typeof metaBin === "number" && metaBin > 0) return metaBin;
    try {
      const firstRange = baseChartData[0].time;
      const [start, end] = firstRange.split("-");
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      const startMinutes = sh * 60 + sm;
      const endMinutes = eh * 60 + em;
      const diff = endMinutes - startMinutes;
      return diff > 0 ? diff : 60;
    } catch {
      return 60;
    }
  })();

  const binsPerHour = Math.max(1, Math.round(60 / timeBinMinutes));

  const chartData: ChartDataPoint[] = baseChartData.map((_, idx) => {
    let rollingSum = 0;
    const endIdx = Math.min(idx + binsPerHour, baseChartData.length);
    for (let j = idx; j < endIdx; j++) {
      rollingSum += baseChartData[j].count;
    }
    return { ...baseChartData[idx], count: rollingSum };
  });

  const flightTableData = useMemo(() => {
    if (!orderedFlightsData) return [];

    return orderedFlightsData.ordered_flights
      .map((flightId) => {
        const flight = flights.find((f) => String(f.flightId) === String(flightId));
        const detail = orderedFlightsData.details.find((d) => String(d.flight_id) === String(flightId));
        return {
          flightId,
          callsign: flight?.callSign || "N/A",
          origin: flight?.origin || "N/A",
          destination: flight?.destination || "N/A",
          takeoffTime: flight ? formatTime(flight.t0) : "N/A",
          arrivalTime: detail?.arrival_time || "N/A",
          deltaSeconds: detail?.delta_seconds || 0,
          dwellSeconds: detail?.dwell_seconds ?? null,
          arrivalSeconds: detail?.arrival_seconds ?? null,
        };
      })
      .slice(0, 500);
  }, [orderedFlightsData, flights]);

  useEffect(() => {
    setExpanded(false);
  }, [selectedCollapsedSector, focusMode, interestWindowLength, orderedFlightsData]);

  const { chartData: displayChartData, flightTableData: displayFlightTableData, filteredFlightIds } = useMemo(() => {
    if (!focusMode || !occupancyData || !orderedFlightsData) {
      return {
        chartData,
        flightTableData,
        filteredFlightIds: new Set<string>(),
      };
    }

    const windowSeconds = getInterestWindowSeconds(interestWindowLength);
    const windowEndTime = t + windowSeconds;

    const filteredChartData = chartData.filter((dataPoint) => {
      const pointTimeSeconds = dataPoint.hour * 3600;
      return pointTimeSeconds >= t && pointTimeSeconds <= windowEndTime;
    });

    const nextFilteredIds = new Set<string>();
    for (const detail of orderedFlightsData.details) {
      if (detail.arrival_seconds >= t && detail.arrival_seconds <= windowEndTime) {
        nextFilteredIds.add(String(detail.flight_id));
      }
    }

    const detailByFlightId = new Map<string, OrderedSectorFlightsData["details"][number]>();
    for (const detail of orderedFlightsData.details) {
      detailByFlightId.set(String(detail.flight_id), detail);
    }

    const filteredFlightTableData = flightTableData
      .filter((row) => nextFilteredIds.has(String(row.flightId)))
      .sort((a, b) => {
        const da = detailByFlightId.get(String(a.flightId));
        const db = detailByFlightId.get(String(b.flightId));
        return Math.abs(da?.delta_seconds ?? 0) - Math.abs(db?.delta_seconds ?? 0);
      })
      .slice(0, 500);

    return {
      chartData: filteredChartData,
      flightTableData: filteredFlightTableData,
      filteredFlightIds: nextFilteredIds,
    };
  }, [focusMode, occupancyData, orderedFlightsData, chartData, flightTableData, interestWindowLength, t]);

  const hiddenFlightCount = Math.max(0, displayFlightTableData.length - MAX_VISIBLE);

  const visibleFlightTableData = useMemo(() => {
    if (!displayFlightTableData) return [] as typeof displayFlightTableData;
    if (!expanded && displayFlightTableData.length > MAX_VISIBLE) {
      return displayFlightTableData.slice(0, MAX_VISIBLE);
    }
    return displayFlightTableData;
  }, [displayFlightTableData, expanded]);

  const hourGlassData = useMemo(() => {
    if (!orderedFlightsData || displayFlightTableData.length === 0) return [] as string[];
    const wanted = new Set(displayFlightTableData.map((row) => String(row.flightId)));
    const values: string[] = [];
    for (const detail of orderedFlightsData.details) {
      if (wanted.has(String(detail.flight_id)) && detail.arrival_time) {
        values.push(String(detail.arrival_time));
      }
    }
    return values;
  }, [orderedFlightsData, displayFlightTableData]);

  useEffect(() => {
    if (!focusMode) return;
    const current = useSimStore.getState().focusFlightIds;
    if (!areSetsEqual(current, filteredFlightIds)) {
      setFocusFlightIds(filteredFlightIds);
    }
  }, [filteredFlightIds, setFocusFlightIds, focusMode]);

  const currentTimeHours = t / 3600;
  const currentXAxisCategory = displayChartData.length
    ? (displayChartData.find((d) => currentTimeHours <= d.hour) ?? displayChartData[displayChartData.length - 1]).time
    : undefined;

  const currentCount = displayChartData.length
    ? (displayChartData.find((d) => currentTimeHours <= d.hour) ?? displayChartData[displayChartData.length - 1]).count
    : 0;

  const formatXAxisTick = (tickItem: string, index: number) => {
    if (index % 12 === 0) {
      const [startTime] = tickItem.split("-");
      const [hours] = startTime.split(":").map(Number);
      return hours.toString();
    }
    return "";
  };

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string;
  }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800/90 backdrop-blur-sm border border-white/20 rounded-lg p-2 text-white text-sm">
          <p className="font-medium">{label}</p>
          <p className="text-blue-300">
            Flights: <span className="font-medium">{payload[0].value}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {!selectedCollapsedSector ? (
        <div className="text-center py-8 opacity-70">
          <p className="text-sm">Click on a collapsed sector to view occupancy data</p>
        </div>
      ) : (
        <>
          <div className="border-b border-white/20 pb-3">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-sm opacity-90">Selected Collapsed Sector</h3>
                <p className="text-lg font-semibold">{selectedCollapsedSector}</p>
                {flightLevelRange && <p className="text-xs opacity-70 mt-1">{flightLevelRange}</p>}
              </div>
              <button
                onClick={() => {
                  const newFocusMode = !focusMode;
                  setFocusMode(newFocusMode);
                  if (!newFocusMode) {
                    setFocusFlightIds(new Set());
                  }
                }}
                className={`flex flex-col items-center px-3 py-2 rounded-lg backdrop-blur-sm border transition-all duration-200 min-w-[70px] ${
                  focusMode
                    ? "bg-blue-500/30 border-blue-400/50 text-blue-200"
                    : "bg-white/10 border-white/20 text-white/80 hover:bg-white/15 hover:border-white/30"
                }`}
              >
                <div className="text-lg mb-1">🎯</div>
                <span className="text-xs font-medium">Focus</span>
              </button>
            </div>
          </div>

          {focusMode && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-sm opacity-90">Interest Window Length</h4>
              <div className="grid grid-cols-4 gap-2">
                {["15", "30", "45", "1h", "2h", "4h", "6h"].map((duration) => (
                  <button
                    key={duration}
                    onClick={() => setInterestWindowLength(duration)}
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
          )}

          {(loading || metadataLoading) && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]"></div>
              <ShimmeringText text="Loading..." className="ml-2 text-sm opacity-70 font-normal" />
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3">
              <p className="text-sm text-red-200">Error: {error}</p>
            </div>
          )}

          {occupancyData && !loading && !error && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white/10 rounded-lg p-3">
                  <p className="text-xs opacity-70">Mvmnts</p>
                  <p className="text-lg font-semibold">{occupancyData.metadata.total_flights_in_sector}</p>
                </div>
                <div className="bg-white/10 rounded-lg p-3">
                  <p className="text-xs opacity-70">Count</p>
                  <p className="text-lg font-semibold">{currentCount}</p>
                </div>
                <div className="bg-white/10 rounded-lg p-3">
                  <p className="text-xs opacity-70">Airblocks</p>
                  <p className="text-lg font-semibold">{sectorMetadata?.airblock_count ?? "-"}</p>
                </div>
                <div className="bg-white/10 rounded-lg p-3">
                  <p className="text-xs opacity-70">ES Count</p>
                  <p className="text-lg font-semibold">{sectorMetadata?.tv_count ?? "-"}</p>
                </div>
              </div>

              <div className="bg-white/5 rounded-lg p-4">
                <h4 className="font-medium text-sm mb-3 opacity-90">Rolling Hour Occupancy</h4>
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={displayChartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barCategoryGap={0} barGap={0}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis
                        dataKey="time"
                        tick={{ fill: "#e2e8f0", fontSize: 10 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickFormatter={formatXAxisTick}
                        interval={0}
                        tickMargin={0}
                        padding={{ left: 0, right: 0 }}
                        height={16}
                      />
                      <YAxis
                        tick={{ fill: "#e2e8f0", fontSize: 10 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickMargin={0}
                        width={26}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar
                        dataKey="count"
                        fill="#06b6d4"
                        radius={[2, 2, 0, 0]}
                        onClick={(_, index) => {
                          const point = displayChartData[index];
                          if (point && point.hour !== undefined) {
                            setT(point.hour * 3600);
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      />
                      {currentXAxisCategory && (
                        <ReferenceLine
                          x={currentXAxisCategory}
                          stroke="#ef4444"
                          strokeWidth={2}
                          strokeDasharray="0"
                          label={{ value: "Current Time", position: "top", fill: "#ef4444", fontSize: 10 }}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center space-x-4 mt-2 text-xs opacity-70">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-cyan-500 rounded mr-1"></div>
                    <span>Occupancy</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-sm opacity-90">Flight List</h4>
                <FlightStatisticsButton
                  flightIds={displayFlightTableData.map((flight) => flight.flightId)}
                  sourceTrafficVolumeId={null}
                  buttonClassName="border-white/20 text-white/80"
                />
              </div>
              {focusMode && (
                <span className="text-xs bg-blue-500/20 text-blue-200 px-2 py-1 rounded border border-blue-400/30">
                  Focus Mode: {interestWindowLength}
                </span>
              )}
            </div>

            {hourGlassData.length > 0 && <HourGlass data={hourGlassData} label height={12} className="my-2" />}

            {flightListLoading && (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]"></div>
                <ShimmeringText text="Loading flights..." className="ml-2 text-xs opacity-70 font-normal" />
              </div>
            )}

            {flightListError && (
              <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-2 mb-3">
                <p className="text-xs text-red-200">Error: {flightListError}</p>
              </div>
            )}

            {displayFlightTableData.length > 0 && !flightListLoading && (
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-white/10">
                      <th className="text-left p-2 font-semibold">CS</th>
                      <th className="text-left p-2 font-semibold">Ori.</th>
                      <th className="text-left p-2 font-semibold">Des.</th>
                      <th className="text-left p-2 font-semibold">T/O</th>
                      <th className="text-left p-2 font-semibold">CS Arr.</th>
                      <th className="text-left p-2 font-semibold">Dwell</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleFlightTableData.map((flight, index) => (
                      <tr
                        key={String(flight.flightId)}
                        className={`border-t border-white/10 ${index % 2 === 0 ? "bg-white/0" : "bg-white/5"} hover:bg-white/10 cursor-pointer`}
                        onMouseEnter={() => setFlowPreviewFlightId(String(flight.flightId))}
                        onMouseLeave={() => setFlowPreviewFlightId(null)}
                        onClick={() => {
                          const fullFlight = flights.find((f) => String(f.flightId) === String(flight.flightId));
                          if (fullFlight) {
                            window.dispatchEvent(new CustomEvent("flight-search-select", { detail: { flight: fullFlight } }));
                          }
                        }}
                      >
                        <td className="p-2 font-mono">{flight.callsign}</td>
                        <td className="p-2">{flight.origin}</td>
                        <td className="p-2">{flight.destination}</td>
                        <td className="p-2 text-right font-mono">{flight.takeoffTime}</td>
                        <td className="p-2 text-right font-mono">{flight.arrivalTime}</td>
                        <td className="p-2 text-right font-mono">{formatDwellingTime(flight.dwellSeconds)}</td>
                      </tr>
                    ))}
                    {displayFlightTableData.length > MAX_VISIBLE && (
                      <tr
                        className="border-t border-white/10 cursor-pointer hover:bg-white/10"
                        onClick={() => setExpanded(!expanded)}
                      >
                        <td className="p-2 text-center italic opacity-80" colSpan={6}>
                          {expanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenFlightCount)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {expanded && displayFlightTableData.length === 500 && (
                  <p className="text-xs opacity-70 text-center mt-2">Showing first 500 flights</p>
                )}
                {orderedFlightsData && (
                  <p className="text-xs opacity-70 text-center mt-2">
                    Flights ordered by proximity to current time ({formatTime(t)})
                  </p>
                )}
              </div>
            )}

            {displayFlightTableData.length === 0 && !flightListLoading && !flightListError && (
              <p className="text-xs opacity-70 text-center py-4">No flights found for this sector</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
