"use client";

import { useMemo, useState } from "react";
import { useSimStore } from "@/components/useSimStore";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";

const MAX_VISIBLE = 24;

type RerouteBaseFlightListPanelProps = {
  embedded?: boolean;
};

export default function RerouteBaseFlightListPanel({ embedded = false }: RerouteBaseFlightListPanelProps) {
  const {
    rerouteBaseFlightIds,
    clearRerouteBaseFlightIds,
    flights,
    setFlowPreviewFlightId,
  } = useSimStore();

  const [expanded, setExpanded] = useState(false);

  const flightsById = useMemo(() => {
    const map = new Map<string, (typeof flights)[number]>();
    for (const flight of flights) {
      const id = String(flight?.flightId ?? "").trim();
      if (!id) continue;
      map.set(id, flight);
    }
    return map;
  }, [flights]);

  const rows = useMemo(
    () =>
      rerouteBaseFlightIds.map((id) => {
        const flight = flightsById.get(String(id));
        return {
          flightId: String(id),
          callSign: flight?.callSign ? String(flight.callSign) : String(id),
          origin: flight?.origin ? String(flight.origin) : "—",
          destination: flight?.destination ? String(flight.destination) : "—",
          takeoffTime: formatTimeOfDay(flight?.t0),
          flight,
        };
      }),
    [rerouteBaseFlightIds, flightsById]
  );

  const visibleRows = expanded ? rows : rows.slice(0, MAX_VISIBLE);
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);
  const panelClassName = embedded
    ? "w-full max-w-[384px] mx-auto rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
    : "absolute top-20 right-4 z-50 min-w-[320px] max-w-[400px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col";

  return (
    <div className={panelClassName}>
      <div className="p-4 border-b border-white/20">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-semibold truncate">Base Flight List</h2>
            <span className="text-xs px-2 py-0.5 rounded-full border border-white/20 bg-white/10">
              {rows.length.toLocaleString("en-US")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <FlightStatisticsButton
              flightIds={rerouteBaseFlightIds}
              buttonClassName="border-white/20 text-white/80"
              title="Open flight statistics"
              ariaLabel="Open flight statistics"
            />
            <button
              type="button"
              onClick={clearRerouteBaseFlightIds}
              disabled={rows.length === 0}
              className="text-xs px-2.5 py-1 rounded-md border border-white/20 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Clear base flight list"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="p-4">
        {rows.length === 0 ? (
          <p className="text-xs opacity-70 text-center py-8">No flights in the base list.</p>
        ) : (
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/10">
                  <th className="text-left p-2 font-semibold">CS</th>
                  <th className="text-left p-2 font-semibold">Ori.</th>
                  <th className="text-left p-2 font-semibold">Des.</th>
                  <th className="text-left p-2 font-semibold">T/O</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr
                    key={`${row.flightId}-${index}`}
                    className={`border-t border-white/10 ${index % 2 === 0 ? "bg-white/0" : "bg-white/5"} hover:bg-white/10 cursor-pointer`}
                    onMouseEnter={() => setFlowPreviewFlightId(row.flightId)}
                    onMouseLeave={() => setFlowPreviewFlightId(null)}
                    onClick={() => {
                      if (!row.flight) return;
                      window.dispatchEvent(
                        new CustomEvent("flight-search-select", { detail: { flight: row.flight } })
                      );
                    }}
                  >
                    <td className="p-2 font-mono">{row.callSign}</td>
                    <td className="p-2">{row.origin}</td>
                    <td className="p-2">{row.destination}</td>
                    <td className="p-2 text-right font-mono">{row.takeoffTime}</td>
                  </tr>
                ))}
                {rows.length > MAX_VISIBLE && (
                  <tr
                    className="border-t border-white/10 cursor-pointer hover:bg-white/10"
                    onClick={() => setExpanded((prev) => !prev)}
                  >
                    <td className="p-2 text-center italic opacity-80" colSpan={4}>
                      {expanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenCount)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTimeOfDay(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds ?? NaN)) return "—";
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
