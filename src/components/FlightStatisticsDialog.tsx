"use client";

import FlightQueryDialog from "./FlightQueryDialog";

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
  fullScreen = false,
  sourceTrafficVolumeId,
}: FlightStatisticsDialogProps) {
  return (
    <FlightQueryDialog
      open={open}
      onClose={onClose}
      flightIds={flightIds}
      highlightLabel="Flight list"
      baselineLabel="Baseline"
      fullScreen={fullScreen}
      sourceTrafficVolumeId={sourceTrafficVolumeId}
    />
  );
}
