"use client";

import { useMemo } from "react";
import ModalDialog from "./ModalDialog";
import FlightListStatistics, { buildAnalysisForFlightIds } from "./FlightListStatistics";
import { useSimStore } from "./useSimStore";
import FlightPathsMiniMap from "./FlightPathsMiniMap";

interface FlightStatisticsDialogProps {
  open: boolean;
  onClose: () => void;
  flightIds: string[];
  baselineFlightIds?: string[];
  fullScreen?: boolean;
}

export default function FlightStatisticsDialog({
  open,
  onClose,
  flightIds,
  baselineFlightIds,
  fullScreen = false,
}: FlightStatisticsDialogProps) {
  const flights = useSimStore((state) => state.flights);

  const analysisSnapshot = useMemo(
    () => buildAnalysisForFlightIds(flights, flightIds),
    [flights, flightIds],
  );

  const baselineAnalysis = useMemo(
    () => (baselineFlightIds && baselineFlightIds.length > 0 ? buildAnalysisForFlightIds(flights, baselineFlightIds) : null),
    [baselineFlightIds, flights],
  );

  const matchedCount = analysisSnapshot.selectedFlights.length;
  const baselineMatchedCount = baselineAnalysis?.selectedFlights.length ?? 0;
  const mapMode = matchedCount > 0 ? "query" : baselineMatchedCount > 0 ? "baseline" : "none";
  const mapFlightCount = mapMode === "query" ? matchedCount : mapMode === "baseline" ? baselineMatchedCount : 0;
  const mapSummaryLabel = mapMode === "baseline" ? "Baseline flights" : "Selected flights";
  const mapHelperText =
    mapMode === "baseline"
      ? "Showing baseline flight paths because no query flights were matched."
      : mapMode === "query"
        ? "Visualizing the currently selected flight paths."
        : "Flight path geometry is unavailable for the requested flights.";

  const title = `Flight List Insights${analysisSnapshot.requestedUniqueCount > 0 ? ` (${matchedCount.toLocaleString("en-US")})` : ""}`;

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={title}
      description="Interactive insights for selected flights"
      width={fullScreen ? "w-[calc(100vw-3rem)]" : undefined}
      height={fullScreen ? "h-[calc(100vh-3rem)]" : undefined}
    >
      <div className="flex flex-col gap-6 p-6 text-white lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <FlightListStatistics
            flightIds={flightIds}
            baselineFlightIds={baselineFlightIds}
            className="space-y-6"
          />
        </div>
        <aside className="w-full flex-shrink-0 lg:w-[320px] xl:w-[360px]">
          <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-inner shadow-slate-900/30">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-semibold uppercase tracking-wide text-white/70">Flight paths</div>
              <div className="text-xs text-white/60">
                {mapMode === "none"
                  ? "No flights available"
                  : `${mapSummaryLabel} · ${mapFlightCount.toLocaleString("en-US")}${mapFlightCount === 1 ? " flight" : " flights"}`}
              </div>
            </div>
            <div className="flex-1">
              <div className="relative w-full min-h-[220px] overflow-hidden rounded-xl border border-white/10 bg-slate-950/40">
                <FlightPathsMiniMap
                  flightIds={flightIds}
                  baselineFlightIds={baselineFlightIds}
                  className="h-full w-full"
                />
              </div>
            </div>
            <p className="text-xs text-white/55">{mapHelperText}</p>
          </div>
        </aside>
      </div>
    </ModalDialog>
  );
}
