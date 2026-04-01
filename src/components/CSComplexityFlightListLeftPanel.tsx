"use client";

import { useEffect, useMemo, useState } from "react";

import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import HourGlass from "@/components/HourGlass";
import ShimmeringText from "@/components/ShimmeringText";
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import { getInterestWindowSeconds } from "@/lib/csComplexity";
import { formatDwellingTime } from "@/lib/dwellTime";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import { formatSecondsToHHMM, formatSecondsToHHMMSS } from "@/lib/time";
import { formatFlightLevelRange } from "@/lib/trafficVolumeFormat";

const MAX_VISIBLE = 20;

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

type FlightListRow = {
  flightId: string;
  callsign: string;
  origin: string;
  destination: string;
  takeoffTime: string;
  arrivalTime: string;
  dwellSeconds: number | null;
};

type CSComplexityFlightListLeftPanelProps = {
  embedded?: boolean;
  interestWindowLength: string;
};

function formatTimeForApi(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return `${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}${String(secs).padStart(2, "0")}`;
}

export default function CSComplexityFlightListLeftPanel({
  embedded = false,
  interestWindowLength,
}: CSComplexityFlightListLeftPanelProps) {
  const {
    selectedCollapsedSector,
    selectedCollapsedSectorData,
    flights,
    resourceStateEpoch,
    t,
    setFlowPreviewFlightId,
  } = useSimStore();

  const [orderedFlightsData, setOrderedFlightsData] = useState<OrderedSectorFlightsData | null>(null);
  const [flightListLoading, setFlightListLoading] = useState(false);
  const [flightListError, setFlightListError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setOrderedFlightsData(null);
    setFlightListError(null);
    setFlightListLoading(false);
    setExpanded(false);
  }, [resourceStateEpoch]);

  useEffect(() => {
    return () => {
      setFlowPreviewFlightId(null);
    };
  }, [setFlowPreviewFlightId]);

  useEffect(() => {
    if (!selectedCollapsedSector) {
      setOrderedFlightsData(null);
      setFlightListError(null);
      setFlightListLoading(false);
      return;
    }

    let cancelled = false;
    const fetchSectorFlights = async () => {
      setFlightListLoading(true);
      setFlightListError(null);
      try {
        const response = await authFetch(
          `/api/sector_flights?elementary_sector_id=${encodeURIComponent(selectedCollapsedSector)}&ref_time_str=${encodeURIComponent(formatTimeForApi(t))}`,
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(errorData.error || `Failed to fetch sector flights: ${response.statusText}`);
        }

        const data = (await response.json()) as OrderedSectorFlightsData;
        if (!cancelled) {
          setOrderedFlightsData(data);
        }
      } catch (error) {
        if (!cancelled) {
          setOrderedFlightsData(null);
          setFlightListError(error instanceof Error ? error.message : "Failed to fetch sector flights");
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

  const flightsById = useMemo(() => {
    const map = new Map<string, (typeof flights)[number]>();
    for (const flight of flights) {
      map.set(String(flight.flightId), flight);
    }
    return map;
  }, [flights]);

  const detailByFlightId = useMemo(() => {
    const map = new Map<string, OrderedSectorFlightsData["details"][number]>();
    for (const detail of orderedFlightsData?.details || []) {
      map.set(String(detail.flight_id), detail);
    }
    return map;
  }, [orderedFlightsData]);

  const flightTableData = useMemo(() => {
    if (!orderedFlightsData) return [] as FlightListRow[];

    return orderedFlightsData.ordered_flights
      .map((flightId) => {
        const normalizedFlightId = String(flightId);
        const flight = flightsById.get(normalizedFlightId);
        const detail = detailByFlightId.get(normalizedFlightId);

        return {
          flightId: normalizedFlightId,
          callsign: flight?.callSign || normalizedFlightId,
          origin: flight?.origin || "N/A",
          destination: flight?.destination || "N/A",
          takeoffTime: typeof flight?.t0 === "number" ? formatSecondsToHHMM(flight.t0) : "N/A",
          arrivalTime: detail?.arrival_time || "N/A",
          dwellSeconds: detail?.dwell_seconds ?? null,
        };
      })
      .slice(0, 500);
  }, [detailByFlightId, flightsById, orderedFlightsData]);

  const windowEndTime = Math.min(24 * 60 * 60 - 1, t + getInterestWindowSeconds(interestWindowLength));

  const displayFlightTableData = useMemo(() => {
    if (!orderedFlightsData) return [] as FlightListRow[];

    const filteredFlightIds = new Set<string>();
    for (const detail of orderedFlightsData.details) {
      if (detail.arrival_seconds >= t && detail.arrival_seconds <= windowEndTime) {
        filteredFlightIds.add(String(detail.flight_id));
      }
    }

    return flightTableData
      .filter((row) => filteredFlightIds.has(String(row.flightId)))
      .sort((a, b) => Math.abs(detailByFlightId.get(a.flightId)?.delta_seconds ?? 0) - Math.abs(detailByFlightId.get(b.flightId)?.delta_seconds ?? 0))
      .slice(0, 500);
  }, [detailByFlightId, flightTableData, orderedFlightsData, t, windowEndTime]);

  const visibleFlightTableData = useMemo(() => {
    if (!expanded && displayFlightTableData.length > MAX_VISIBLE) {
      return displayFlightTableData.slice(0, MAX_VISIBLE);
    }
    return displayFlightTableData;
  }, [displayFlightTableData, expanded]);

  const hiddenFlightCount = Math.max(0, displayFlightTableData.length - MAX_VISIBLE);

  const hourGlassData = useMemo(() => {
    if (!orderedFlightsData || displayFlightTableData.length === 0) return [] as string[];
    const wanted = new Set(displayFlightTableData.map((row) => row.flightId));
    const values: string[] = [];
    for (const detail of orderedFlightsData.details) {
      if (wanted.has(String(detail.flight_id)) && detail.arrival_time) {
        values.push(String(detail.arrival_time));
      }
    }
    return values;
  }, [displayFlightTableData, orderedFlightsData]);

  useEffect(() => {
    setExpanded(false);
  }, [displayFlightTableData.length, interestWindowLength, selectedCollapsedSector, t]);

  if (!selectedCollapsedSector) {
    return null;
  }

  const panelClassName = embedded
    ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
    : "w-full max-h-[40vh] min-h-0 flex-shrink-0 rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col overflow-hidden";
  const selectedFlightLevelRange = formatFlightLevelRange(
    selectedCollapsedSectorData?.properties?.min_fl,
    selectedCollapsedSectorData?.properties?.max_fl,
  );

  return (
    <div className={panelClassName}>
      <div className="flex items-center justify-between gap-3 border-b border-white/20 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-semibold text-sm truncate">Flight List ({displayFlightTableData.length})</h3>
            <FlightStatisticsButton
              flightIds={displayFlightTableData.map((flight) => flight.flightId)}
              buttonClassName="border-white/20 text-white/80"
            />
          </div>
          <p className="mt-1 truncate text-[11px] text-white/65">
            {selectedCollapsedSector}
            {selectedFlightLevelRange ? ` • ${selectedFlightLevelRange}` : ""}
          </p>
        </div>
        <span className="shrink-0 text-xs text-white/70">
          {formatSecondsToHHMMSS(t)}-{formatSecondsToHHMMSS(windowEndTime)}
        </span>
      </div>

      <div className={embedded ? "px-3 pb-3 overflow-x-auto" : "flex-1 min-h-0 overflow-y-auto overflow-x-auto px-3 pb-3"}>
        {hourGlassData.length > 0 && (
          <div className="py-2">
            <HourGlass
              data={hourGlassData}
              range={[formatSecondsToHHMM(t), formatSecondsToHHMM(windowEndTime)]}
              height={12}
              defaultColor="#38bdf8"
              lineWidth={1}
              lineHeightPct={0.7}
              gloss={false}
            />
          </div>
        )}

        {flightListLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
            <ShimmeringText text="Loading flights..." className="ml-2 text-xs opacity-70 font-normal" />
          </div>
        ) : flightListError ? (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/20 p-2">
            <p className="text-xs text-red-200">{flightListError}</p>
          </div>
        ) : displayFlightTableData.length > 0 ? (
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/10">
                  <th className="p-2 text-left font-semibold">CS</th>
                  <th className="p-2 text-left font-semibold">Ori.</th>
                  <th className="p-2 text-left font-semibold">Des.</th>
                  <th className="p-2 text-left font-semibold">T/O</th>
                  <th className="p-2 text-left font-semibold">CS Arr.</th>
                  <th className="p-2 text-left font-semibold">Dwell</th>
                </tr>
              </thead>
              <tbody>
                {visibleFlightTableData.map((flight, index) => (
                  <tr
                    key={flight.flightId}
                    className={`cursor-pointer border-t border-white/10 ${index % 2 === 0 ? "bg-white/0" : "bg-white/5"} hover:bg-white/10`}
                    onMouseEnter={() => setFlowPreviewFlightId(flight.flightId)}
                    onMouseLeave={() => setFlowPreviewFlightId(null)}
                    onClick={() => {
                      const fullFlight = flightsById.get(flight.flightId);
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
                    className="cursor-pointer border-t border-white/10 hover:bg-white/10"
                    onClick={() => setExpanded((current) => !current)}
                  >
                    <td className="p-2 text-center italic opacity-80" colSpan={6}>
                      {expanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenFlightCount)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {expanded && displayFlightTableData.length === 500 && (
              <p className="mt-2 text-center text-xs opacity-70">Showing first 500 flights</p>
            )}
          </div>
        ) : (
          <p className="py-4 text-center text-xs opacity-70">No flights found in the selected forward window</p>
        )}
      </div>
    </div>
  );
}
