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
  sourceTrafficVolumeId?: string | null;
}

export default function FlightStatisticsDialog({
  open,
  onClose,
  flightIds,
  baselineFlightIds,
  fullScreen = false,
  sourceTrafficVolumeId,
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
      <div className="flex h-full min-h-0 flex-col overflow-hidden text-white lg:flex-row">
        <div className="flex-1 min-w-0 overflow-y-auto no-scrollbar p-6">
          <FlightListStatistics
            flightIds={flightIds}
            baselineFlightIds={baselineFlightIds}
            sourceTrafficVolumeId={sourceTrafficVolumeId}
            className="space-y-6"
          />
        </div>
        <aside className="relative h-64 w-full flex-shrink-0 border-t border-white/10 bg-slate-950/40 lg:h-full lg:w-[380px] lg:border-t-0 lg:border-l xl:w-[420px]">
          <FlightPathsMiniMap
            flightIds={flightIds}
            baselineFlightIds={baselineFlightIds}
            className="relative h-full w-full"
          />
        </aside>
      </div>
    </ModalDialog>
  );
}
