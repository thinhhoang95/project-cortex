"use client";

import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import ShimmeringText from "@/components/ShimmeringText";
import type { RadFlightRow, RadLegitimacyFlag } from "@/lib/radPreview";

type RadPreviewFlightListPanelProps = {
  rows: RadFlightRow[];
  selectedRadId: string | null;
  legitimacyFlag: RadLegitimacyFlag;
  sourceTrafficVolumeId?: string | null;
  tvArrivalTimeByFlightId?: ReadonlyMap<string, string>;
  subtitle?: string | null;
  emptyMessage?: string;
  loading: boolean;
  error: string | null;
  hoveredFlightId: string | null;
  onHoverFlightIdChange: (flightId: string | null) => void;
};

export default function RadPreviewFlightListPanel({
  rows,
  selectedRadId,
  legitimacyFlag,
  sourceTrafficVolumeId,
  tvArrivalTimeByFlightId,
  subtitle,
  emptyMessage,
  loading,
  error,
  hoveredFlightId,
  onHoverFlightIdChange,
}: RadPreviewFlightListPanelProps) {
  const unresolvedCount = rows.filter((row) => row.unresolved).length;
  const showTvArrivalTime = Boolean(sourceTrafficVolumeId);

  return (
    <div className="flex flex-col w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white">
      <div className="border-b border-white/15 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Affected Flights</h2>
            <p className="mt-1 text-xs text-white/70">
              {subtitle ?? (selectedRadId ? `${selectedRadId} · flag ${legitimacyFlag}` : "Select a RAD to preview flights")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px]">
              {rows.length.toLocaleString("en-US")}
            </span>
            <FlightStatisticsButton
              flightIds={rows.map((row) => row.flightId)}
              buttonClassName="border-white/20 text-white/80"
              title="Open flight statistics"
              ariaLabel="Open flight statistics for RAD flights"
              sourceTrafficVolumeId={sourceTrafficVolumeId}
            />
          </div>
        </div>
        {unresolvedCount > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {unresolvedCount} flight{unresolvedCount === 1 ? "" : "s"} could not be resolved to local trajectory metadata.
          </div>
        )}
      </div>
      <div className="p-4">
        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-white/70">
            <Spinner />
            <ShimmeringText
              text="Loading affected flights..."
              className="ml-2 text-sm font-normal text-white/70"
            />
          </div>
        )}
        {!loading && error && (
          <div className="rounded-lg border border-red-300/30 bg-red-500/10 px-3 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="py-8 text-center text-sm text-white/60">
            {emptyMessage ?? (selectedRadId ? "No flights matched this RAD for the current legitimacy flag." : "No RAD selected.")}
          </div>
        )}
        {!loading && !error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-white/10">
                  <th className="px-3 py-2 text-left font-semibold">CS / ID</th>
                  <th className="px-3 py-2 text-left font-semibold">Origin</th>
                  <th className="px-3 py-2 text-left font-semibold">Destination</th>
                  <th className="px-3 py-2 text-left font-semibold">T/O</th>
                  {showTvArrivalTime && (
                    <th
                      className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                      title={`Crossing time for ${sourceTrafficVolumeId}`}
                    >
                      TV Arr.
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const isHovered = hoveredFlightId === row.flightId;
                  return (
                    <tr
                      key={`${row.flightId}-${index}`}
                      className={`border-t border-white/10 transition-colors ${
                        isHovered
                          ? "bg-cyan-400/15"
                          : index % 2 === 0
                            ? "bg-white/0 hover:bg-white/10"
                            : "bg-white/5 hover:bg-white/10"
                      } ${row.flight ? "cursor-pointer" : "cursor-default"}`}
                      onMouseEnter={() => onHoverFlightIdChange(row.flightId)}
                      onMouseLeave={() => onHoverFlightIdChange(null)}
                      onClick={() => {
                        if (!row.flight) return;
                        window.dispatchEvent(
                          new CustomEvent("flight-search-select", { detail: { flight: row.flight } }),
                        );
                      }}
                    >
                      <td className="px-3 py-2 font-mono">
                        <div>{row.callSign}</div>
                        {row.unresolved && <div className="mt-0.5 text-[11px] text-amber-200">metadata unavailable</div>}
                      </td>
                      <td className="px-3 py-2">{row.origin}</td>
                      <td className="px-3 py-2">{row.destination}</td>
                      <td className="px-3 py-2 font-mono">{row.takeoffTime}</td>
                      {showTvArrivalTime && (
                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                          {tvArrivalTimeByFlightId?.get(row.flightId) ?? "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return <div className="h-4 w-4 animate-spin rounded-full border border-white/20 border-t-white/80" />;
}
