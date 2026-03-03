"use client";

import { useMemo } from "react";

import TrafficVolumeReliefMap from "@/components/TrafficVolumeReliefMap";
import {
  computeShockwaveDeltaByTv,
  formatShockwaveHorizonLabel,
} from "@/lib/trafficVolumeShockwaves";

type CountsByTv = Record<string, number[] | undefined>;

interface TrafficVolumeShockwavesProps {
  countsByTv?: CountsByTv | null;
  binMinutes: number;
  selectedTime: string;
  offsetMinutes: number;
  labels?: string[];
  startBin?: number;
  tvIds?: string[];
  className?: string;
  heightClassName?: string;
  loading?: boolean;
  emptyMessage?: string;
}

export default function TrafficVolumeShockwaves({
  countsByTv,
  binMinutes,
  selectedTime,
  offsetMinutes,
  labels,
  startBin,
  tvIds,
  className,
  heightClassName,
  loading,
  emptyMessage,
}: TrafficVolumeShockwavesProps) {
  const deltasByTv = useMemo(
    () =>
      computeShockwaveDeltaByTv({
        counts: countsByTv,
        binMinutes,
        selectedTime,
        offsetMinutes,
        labels,
        startBin,
        tvIds,
      }),
    [countsByTv, binMinutes, selectedTime, offsetMinutes, labels, startBin, tvIds],
  );

  const horizonLabel = formatShockwaveHorizonLabel(offsetMinutes);
  const effectiveEmptyMessage =
    emptyMessage ||
    `No traffic-volume counts available to compare ${selectedTime} and ${horizonLabel}.`;

  return (
    <TrafficVolumeReliefMap
      deltasByTv={deltasByTv}
      className={className}
      heightClassName={heightClassName}
      loading={loading}
      emptyMessage={effectiveEmptyMessage}
      negativeLegendLabel="Decrease"
      positiveLegendLabel="Burst"
    />
  );
}
