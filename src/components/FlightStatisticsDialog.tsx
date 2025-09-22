"use client";

import { useMemo } from "react";
import ModalDialog from "./ModalDialog";
import { useSimStore } from "./useSimStore";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Bar,
} from "recharts";
import { Trajectory } from "@/lib/models";

interface FlightStatisticsDialogProps {
  open: boolean;
  onClose: () => void;
  flightIds: string[];
}

type AirportSlice = {
  name: string;
  value: number;
  percent: number;
  isOthers?: boolean;
};

type PieData = {
  slices: AirportSlice[];
  total: number;
  primarySum: number;
  limitApplied: number;
};

type AirportTotalRow = {
  airport: string;
  originCount: number;
  destinationCount: number;
  total: number;
};

type TakeoffHourRow = {
  hour: number;
  label: string;
  flights: number;
};

type RouteRow = {
  origin: string;
  destination: string;
  count: number;
};

type DurationStats = {
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  count: number;
};

type LongestFlightInfo = {
  id: string;
  callSign?: string;
  origin: string;
  destination: string;
  duration: number;
};

interface Analysis {
  selectedFlights: Trajectory[];
  requestedUniqueCount: number;
  missingCount: number;
  missingIds: string[];
  uniqueOrigins: number;
  uniqueDestinations: number;
  earliestTakeoff: number | null;
  latestTakeoff: number | null;
  takeoffKnown: number;
  topOrigins: PieData;
  topDestinations: PieData;
  airportTotals: AirportTotalRow[];
  takeoffByHour: TakeoffHourRow[];
  durations: DurationStats;
  routeRows: RouteRow[];
  routeCount: number;
  busiestTakeoffHour: TakeoffHourRow | null;
  longestFlight: LongestFlightInfo | null;
}

const PIE_COLORS = [
  "#60a5fa",
  "#a855f7",
  "#38bdf8",
  "#f97316",
  "#22c55e",
  "#facc15",
  "#f472b6",
  "#94a3b8",
  "#14b8a6",
  "#ef4444",
  "#c084fc",
  "#f59e0b",
];

const ORIGIN_BAR_COLOR = "#38bdf8";
const DESTINATION_BAR_COLOR = "#f97316";

const EMPTY_ANALYSIS: Analysis = {
  selectedFlights: [],
  requestedUniqueCount: 0,
  missingCount: 0,
  missingIds: [],
  uniqueOrigins: 0,
  uniqueDestinations: 0,
  earliestTakeoff: null,
  latestTakeoff: null,
  takeoffKnown: 0,
  topOrigins: { slices: [], total: 0, primarySum: 0, limitApplied: 0 },
  topDestinations: { slices: [], total: 0, primarySum: 0, limitApplied: 0 },
  airportTotals: [],
  takeoffByHour: [],
  durations: { average: null, median: null, min: null, max: null, count: 0 },
  routeRows: [],
  routeCount: 0,
  busiestTakeoffHour: null,
  longestFlight: null,
};

export default function FlightStatisticsDialog({ open, onClose, flightIds }: FlightStatisticsDialogProps) {
  const flights = useSimStore(state => state.flights);

  const analysis = useMemo<Analysis>(() => {
    if (!Array.isArray(flightIds) || flightIds.length === 0) {
      return EMPTY_ANALYSIS;
    }

    const seen = new Set<string>();
    const orderedIds: string[] = [];
    for (const raw of flightIds) {
      if (raw === undefined || raw === null) continue;
      const normalized = String(raw).trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      orderedIds.push(normalized);
    }

    if (orderedIds.length === 0) {
      return EMPTY_ANALYSIS;
    }

    const byId = new Map<string, Trajectory>();
    for (const flight of flights) {
      byId.set(String(flight.flightId), flight);
    }

    const selectedFlights: Trajectory[] = [];
    const missingIds: string[] = [];
    for (const id of orderedIds) {
      const flight = byId.get(id);
      if (flight) {
        selectedFlights.push(flight);
      } else {
        missingIds.push(id);
      }
    }

    if (selectedFlights.length === 0) {
      return {
        ...EMPTY_ANALYSIS,
        requestedUniqueCount: orderedIds.length,
        missingCount: missingIds.length,
        missingIds,
      };
    }

    const originCounts = new Map<string, number>();
    const destinationCounts = new Map<string, number>();
    const routeCounts = new Map<string, RouteRow>();
    const takeoffHistogram = Array.from({ length: 24 }, () => 0);

    let earliest = Number.POSITIVE_INFINITY;
    let latest = Number.NEGATIVE_INFINITY;
    let takeoffKnown = 0;

    const durations: number[] = [];
    let totalDuration = 0;
    let minDuration = Number.POSITIVE_INFINITY;
    let maxDuration = Number.NEGATIVE_INFINITY;
    let longestFlight: LongestFlightInfo | null = null;

    for (const flight of selectedFlights) {
      const origin = normalizeAirport(flight.origin);
      const destination = normalizeAirport(flight.destination);

      originCounts.set(origin, (originCounts.get(origin) ?? 0) + 1);
      destinationCounts.set(destination, (destinationCounts.get(destination) ?? 0) + 1);

      const routeKey = `${origin}→${destination}`;
      const existingRoute = routeCounts.get(routeKey);
      if (existingRoute) {
        existingRoute.count += 1;
      } else {
        routeCounts.set(routeKey, {
          origin,
          destination,
          count: 1,
        });
      }

      const t0 = Number(flight.t0);
      if (Number.isFinite(t0)) {
        takeoffKnown += 1;
        if (t0 < earliest) earliest = t0;
        if (t0 > latest) latest = t0;
        const hourIdx = clampHour(Math.floor(t0 / 3600));
        takeoffHistogram[hourIdx] += 1;
      }

      const t1 = Number(flight.t1);
      if (Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0) {
        const duration = t1 - t0;
        durations.push(duration);
        totalDuration += duration;
        if (duration < minDuration) minDuration = duration;
        if (duration > maxDuration) {
          maxDuration = duration;
          longestFlight = {
            id: String(flight.flightId),
            callSign: sanitizeCallSign(flight.callSign),
            origin,
            destination,
            duration,
          };
        }
      }
    }

    const topOrigins = createPieData(originCounts);
    const topDestinations = createPieData(destinationCounts);
    const airportTotals = createAirportTotals(originCounts, destinationCounts);
    const takeoffByHour = takeoffHistogram.map((count, hour) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      flights: count,
    }));
    const busiestTakeoffHour = takeoffByHour.reduce<TakeoffHourRow | null>((acc, row) => {
      if (row.flights === 0) return acc;
      if (!acc || row.flights > acc.flights) return row;
      return acc;
    }, null);

    const durationCount = durations.length;
    const averageDuration = durationCount > 0 ? totalDuration / durationCount : null;
    const sortedDurations = durationCount > 0 ? [...durations].sort((a, b) => a - b) : [];
    const medianDuration = durationCount > 0
      ? durationCount % 2 === 1
        ? sortedDurations[(durationCount - 1) / 2]
        : (sortedDurations[durationCount / 2 - 1] + sortedDurations[durationCount / 2]) / 2
      : null;

    const routeRows = Array.from(routeCounts.values())
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (a.origin !== b.origin) return a.origin.localeCompare(b.origin);
        return a.destination.localeCompare(b.destination);
      });

    return {
      selectedFlights,
      requestedUniqueCount: orderedIds.length,
      missingCount: missingIds.length,
      missingIds,
      uniqueOrigins: originCounts.size,
      uniqueDestinations: destinationCounts.size,
      earliestTakeoff: Number.isFinite(earliest) ? earliest : null,
      latestTakeoff: Number.isFinite(latest) ? latest : null,
      takeoffKnown,
      topOrigins,
      topDestinations,
      airportTotals,
      takeoffByHour,
      durations: {
        average: averageDuration,
        median: medianDuration,
        min: durationCount > 0 ? minDuration : null,
        max: durationCount > 0 ? maxDuration : null,
        count: durationCount,
      },
      routeRows,
      routeCount: routeCounts.size,
      busiestTakeoffHour,
      longestFlight,
    };
  }, [flightIds, flights]);

  const matchedCount = analysis.selectedFlights.length;
  const title = `Flight List Insights${analysis.requestedUniqueCount > 0 ? ` (${formatCount(matchedCount)})` : ""}`;

  const topOriginsCoverage = analysis.topOrigins.total > 0
    ? analysis.topOrigins.primarySum / analysis.topOrigins.total
    : 0;
  const topDestinationsCoverage = analysis.topDestinations.total > 0
    ? analysis.topDestinations.primarySum / analysis.topDestinations.total
    : 0;
  const topAirport = analysis.airportTotals[0];
  const airportTouchTotal = matchedCount * 2;
  const topAirportShare = topAirport && airportTouchTotal > 0
    ? topAirport.total / airportTouchTotal
    : 0;
  const topRoutes = analysis.routeRows.slice(0, 10);
  const topRoutesShare = matchedCount > 0
    ? topRoutes.reduce((sum, row) => sum + row.count, 0) / matchedCount
    : 0;

  return (
    <ModalDialog open={open} onClose={onClose} title={title} description="Interactive insights for selected flights">
      <div className="p-6 space-y-6 text-white">
        {matchedCount === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="text-xl font-semibold text-white">No flights to analyze</div>
            <div className="text-sm text-white/70 max-w-md">
              {analysis.requestedUniqueCount === 0
                ? "Add one or more flight identifiers to see statistics."
                : "The requested flight identifiers are not present in the current dataset."}
            </div>
            {analysis.missingIds.length > 0 && (
              <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
                Missing: {analysis.missingIds.slice(0, 6).join(", ")}
                {analysis.missingIds.length > 6 ? "…" : ""}
              </div>
            )}
          </div>
        ) : (
          <>
            {analysis.missingCount > 0 && (
              <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
                Unable to locate {formatCount(analysis.missingCount)} of {formatCount(analysis.requestedUniqueCount)} selected flights in the current dataset.
                {analysis.missingIds.length > 0 && (
                  <div className="mt-1 opacity-80">
                    Missing: {analysis.missingIds.slice(0, 6).join(", ")}
                    {analysis.missingIds.length > 6 ? "…" : ""}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[
                {
                  label: "Flights analyzed",
                  value: formatCount(matchedCount),
                  helper: analysis.requestedUniqueCount > matchedCount
                    ? `Matched ${formatCount(matchedCount)} of ${formatCount(analysis.requestedUniqueCount)}`
                    : undefined,
                },
                {
                  label: "Distinct origins",
                  value: formatCount(analysis.uniqueOrigins),
                },
                {
                  label: "Distinct destinations",
                  value: formatCount(analysis.uniqueDestinations),
                },
                {
                  label: "Distinct routes",
                  value: formatCount(analysis.routeCount),
                },
                {
                  label: "Earliest takeoff",
                  value: formatTimeOfDay(analysis.earliestTakeoff),
                  helper: analysis.takeoffKnown > 0
                    ? `Based on ${formatCount(analysis.takeoffKnown)} flights`
                    : "Not available",
                },
                {
                  label: "Latest takeoff",
                  value: formatTimeOfDay(analysis.latestTakeoff),
                  helper: analysis.takeoffKnown > 0 ? undefined : "Not available",
                },
                {
                  label: "Average duration",
                  value: formatDuration(analysis.durations.average),
                  helper: analysis.durations.count > 0
                    ? `Across ${formatCount(analysis.durations.count)} flights`
                    : "Not available",
                },
                {
                  label: "Median duration",
                  value: formatDuration(analysis.durations.median),
                  helper: analysis.durations.count > 0 ? undefined : "Not available",
                },
                {
                  label: "Longest duration",
                  value: formatDuration(analysis.durations.max),
                  helper: analysis.longestFlight
                    ? `${analysis.longestFlight.origin} → ${analysis.longestFlight.destination} (${analysis.longestFlight.callSign ?? analysis.longestFlight.id})`
                    : "Not available",
                },
              ].map((metric, idx) => (
                <div key={`${metric.label}-${idx}`} className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">{metric.label}</div>
                  <div className="text-2xl font-semibold text-white">{metric.value}</div>
                  {metric.helper && (
                    <div className="text-[12px] text-white/60 mt-1">{metric.helper}</div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Top origins</div>
                  <div className="text-xs text-white/60">
                    {analysis.topOrigins.limitApplied > 0
                      ? `Top ${analysis.topOrigins.limitApplied} cover ${formatPercent(topOriginsCoverage)} of departures`
                      : "No departure data"}
                  </div>
                </div>
                <div className="flex-1">
                  {analysis.topOrigins.slices.length > 0 ? (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={analysis.topOrigins.slices}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={50}
                            outerRadius={90}
                            paddingAngle={1.5}
                          >
                            {analysis.topOrigins.slices.map((slice, index) => (
                              <Cell
                                key={`origin-${slice.name}-${index}`}
                                fill={PIE_COLORS[index % PIE_COLORS.length]}
                                opacity={slice.isOthers ? 0.65 : 1}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => {
                              const numericValue = Number(value);
                              const percent = analysis.topOrigins.total > 0
                                ? (numericValue / analysis.topOrigins.total) * 100
                                : 0;
                              return [`${formatCount(numericValue)} flights (${percent.toFixed(1)}%)`, name];
                            }}
                            contentStyle={{
                              background: "rgba(15,23,42,0.95)",
                              border: "1px solid rgba(255,255,255,0.15)",
                              borderRadius: 8,
                              color: "white",
                            }}
                            itemStyle={{ color: "white" }}
                            labelStyle={{ color: "white" }}
                          />
                          <Legend wrapperStyle={{ color: "#f8fafc" }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-white/70">
                      No origin data available.
                    </div>
                  )}
                </div>
                {analysis.topOrigins.slices.length > 0 && (
                  <div className="mt-4 space-y-1 text-xs">
                    {analysis.topOrigins.slices.map((slice, index) => (
                      <div key={`origin-row-${slice.name}-${index}`} className="flex items-center justify-between text-white/70">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                              opacity: slice.isOthers ? 0.65 : 1,
                            }}
                          />
                          <span className="text-white/80">{slice.name}</span>
                        </div>
                        <div className="font-mono text-white/80">
                          {formatCount(slice.value)} ({formatPercent(slice.percent)})
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Top destinations</div>
                  <div className="text-xs text-white/60">
                    {analysis.topDestinations.limitApplied > 0
                      ? `Top ${analysis.topDestinations.limitApplied} cover ${formatPercent(topDestinationsCoverage)} of arrivals`
                      : "No arrival data"}
                  </div>
                </div>
                <div className="flex-1">
                  {analysis.topDestinations.slices.length > 0 ? (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={analysis.topDestinations.slices}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={50}
                            outerRadius={90}
                            paddingAngle={1.5}
                          >
                            {analysis.topDestinations.slices.map((slice, index) => (
                              <Cell
                                key={`dest-${slice.name}-${index}`}
                                fill={PIE_COLORS[index % PIE_COLORS.length]}
                                opacity={slice.isOthers ? 0.65 : 1}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => {
                              const numericValue = Number(value);
                              const percent = analysis.topDestinations.total > 0
                                ? (numericValue / analysis.topDestinations.total) * 100
                                : 0;
                              return [`${formatCount(numericValue)} flights (${percent.toFixed(1)}%)`, name];
                            }}
                            contentStyle={{
                              background: "rgba(15,23,42,0.95)",
                              border: "1px solid rgba(255,255,255,0.15)",
                              borderRadius: 8,
                              color: "white",
                            }}
                            itemStyle={{ color: "white" }}
                            labelStyle={{ color: "white" }}
                          />
                          <Legend wrapperStyle={{ color: "#f8fafc" }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-white/70">
                      No destination data available.
                    </div>
                  )}
                </div>
                {analysis.topDestinations.slices.length > 0 && (
                  <div className="mt-4 space-y-1 text-xs">
                    {analysis.topDestinations.slices.map((slice, index) => (
                      <div key={`dest-row-${slice.name}-${index}`} className="flex items-center justify-between text-white/70">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                              opacity: slice.isOthers ? 0.65 : 1,
                            }}
                          />
                          <span className="text-white/80">{slice.name}</span>
                        </div>
                        <div className="font-mono text-white/80">
                          {formatCount(slice.value)} ({formatPercent(slice.percent)})
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="md:col-span-2 xl:col-span-3 bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Airport involvement</div>
                  {topAirport ? (
                    <div className="text-xs text-white/60">
                      {topAirport.airport} leads with {formatCount(topAirport.total)} touches ({formatPercent(topAirportShare)})
                    </div>
                  ) : (
                    <div className="text-xs text-white/60">No airport data available</div>
                  )}
                </div>
                {analysis.airportTotals.length > 0 ? (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analysis.airportTotals} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                        <XAxis
                          dataKey="airport"
                          tick={{ fontSize: 11, fill: "#e2e8f0" }}
                          axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "#e2e8f0" }}
                          axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            `${formatCount(Number(value))} flights`,
                            name === "originCount" ? "Origin count" : name === "destinationCount" ? "Destination count" : name,
                          ]}
                          contentStyle={{
                            background: "rgba(15,23,42,0.95)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 8,
                            color: "white",
                          }}
                          itemStyle={{ color: "white" }}
                          labelStyle={{ color: "white" }}
                        />
                        <Legend wrapperStyle={{ color: "#f8fafc" }} />
                        <Bar dataKey="originCount" name="Origins" fill={ORIGIN_BAR_COLOR} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="destinationCount" name="Destinations" fill={DESTINATION_BAR_COLOR} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-white/70">No airport data to display.</div>
                )}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Takeoffs by hour</div>
                  <div className="text-xs text-white/60">
                    {analysis.busiestTakeoffHour
                      ? `Peak at ${analysis.busiestTakeoffHour.label} (${formatCount(analysis.busiestTakeoffHour.flights)} flights)`
                      : analysis.takeoffKnown > 0
                        ? "Even distribution"
                        : "No takeoff data"}
                  </div>
                </div>
                {analysis.takeoffKnown > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analysis.takeoffByHour} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: "#e2e8f0" }}
                          axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "#e2e8f0" }}
                          axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          formatter={(value: number) => [`${formatCount(Number(value))} flights`, "Flights"]}
                          contentStyle={{
                            background: "rgba(15,23,42,0.95)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 8,
                            color: "white",
                          }}
                          itemStyle={{ color: "white" }}
                          labelStyle={{ color: "white" }}
                        />
                        <Bar dataKey="flights" name="Flights" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-white/70">No takeoff times available for the selected flights.</div>
                )}
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Top routes</div>
                  <div className="text-xs text-white/60">
                    {analysis.routeCount > 0
                      ? `${formatCount(analysis.routeCount)} distinct routes · Top ${Math.min(topRoutes.length, 10)} cover ${formatPercent(topRoutesShare)}`
                      : "No route data"}
                  </div>
                </div>
                {topRoutes.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm text-white/90">
                      <thead className="bg-white/5 text-white/70">
                        <tr>
                          <th className="px-3 py-2 text-left">Route</th>
                          <th className="px-3 py-2 text-right">Flights</th>
                          <th className="px-3 py-2 text-right">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topRoutes.map((row, index) => (
                          <tr
                            key={`${row.origin}-${row.destination}-${index}`}
                            className={`border-t border-white/10 ${index % 2 === 1 ? "bg-white/5" : "bg-white/0"}`}
                          >
                            <td className="px-3 py-2 font-medium text-white">
                              {row.origin} → {row.destination}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-white/80">{formatCount(row.count)}</td>
                            <td className="px-3 py-2 text-right font-mono text-white/80">
                              {matchedCount > 0 ? formatPercent(row.count / matchedCount) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-white/70">
                    Not enough route information to display.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </ModalDialog>
  );
}

function normalizeAirport(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "Unknown";
  }
  if (value === null || value === undefined) return "Unknown";
  const text = String(value).trim();
  return text.length > 0 ? text : "Unknown";
}

function sanitizeCallSign(callSign: unknown): string | undefined {
  if (typeof callSign !== "string") return undefined;
  const trimmed = callSign.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  if (hour < 0) return 0;
  if (hour > 23) return 23;
  return hour;
}

function createPieData(map: Map<string, number>, limit = 10): PieData {
  const entries = Array.from(map.entries());
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  const topEntries = entries.slice(0, limit);
  const primarySum = topEntries.reduce((sum, [, value]) => sum + value, 0);
  const slices: AirportSlice[] = topEntries.map(([name, value]) => ({
    name,
    value,
    percent: total > 0 ? value / total : 0,
  }));
  if (entries.length > limit) {
    const othersValue = total - primarySum;
    slices.push({
      name: "Others",
      value: othersValue,
      percent: total > 0 ? othersValue / total : 0,
      isOthers: true,
    });
  }
  return {
    slices,
    total,
    primarySum,
    limitApplied: topEntries.length,
  };
}

function createAirportTotals(originCounts: Map<string, number>, destinationCounts: Map<string, number>, limit = 12): AirportTotalRow[] {
  const totals = new Map<string, AirportTotalRow>();
  for (const [airport, count] of originCounts.entries()) {
    totals.set(airport, {
      airport,
      originCount: count,
      destinationCount: 0,
      total: count,
    });
  }
  for (const [airport, count] of destinationCounts.entries()) {
    const existing = totals.get(airport);
    if (existing) {
      existing.destinationCount += count;
      existing.total += count;
    } else {
      totals.set(airport, {
        airport,
        originCount: 0,
        destinationCount: count,
        total: count,
      });
    }
  }
  return Array.from(totals.values())
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.airport.localeCompare(b.airport);
    })
    .slice(0, limit);
}

function formatTimeOfDay(seconds: number | null): string {
  if (!Number.isFinite(seconds ?? NaN)) return "—";
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDuration(seconds: number | null): string {
  if (!Number.isFinite(seconds ?? NaN)) return "—";
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes === 0 && totalSeconds > 0) return "<1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value).toLocaleString("en-US");
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  if (value <= 0) return "0%";
  if (value >= 0.995) return `${(value * 100).toFixed(0)}%`;
  if (value <= 0.005) return "<0.1%";
  return `${(value * 100).toFixed(1)}%`;
}
