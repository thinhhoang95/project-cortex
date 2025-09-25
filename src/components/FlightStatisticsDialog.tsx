"use client";

import { useMemo } from "react";
import ModalDialog from "./ModalDialog";
import FlightListStatistics, { buildAnalysisForFlightIds } from "./FlightListStatistics";
import { useSimStore } from "./useSimStore";

interface FlightStatisticsDialogProps {
  open: boolean;
  onClose: () => void;
  flightIds: string[];
  fullScreen?: boolean;
}

export default function FlightStatisticsDialog({ open, onClose, flightIds, fullScreen = false }: FlightStatisticsDialogProps) {
  const flights = useSimStore(state => state.flights);

  const analysisSnapshot = useMemo(
    () => buildAnalysisForFlightIds(flights, flightIds),
    [flights, flightIds]
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
      <FlightListStatistics flightIds={flightIds} className="p-6 space-y-6 text-white" />
    </ModalDialog>
  );
}
