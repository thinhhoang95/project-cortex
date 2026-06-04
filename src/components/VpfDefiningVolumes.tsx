"use client";

import TrafficVolumeInfoTooltip from "@/components/TrafficVolumeInfoTooltip";
import type { FlowGroupMetadata } from "@/lib/flowExtractor";

type VpfDefiningVolumesProps = {
  metadata?: Pick<FlowGroupMetadata, "definingVolumes"> | null;
  className?: string;
};

export default function VpfDefiningVolumes({ metadata, className }: VpfDefiningVolumesProps) {
  const volumes = metadata?.definingVolumes ?? [];
  if (volumes.length === 0) return null;

  return (
    <div className={["no-scrollbar min-w-0 max-w-full overflow-x-auto px-2 pt-2 text-[11px] text-white/70", className].filter(Boolean).join(" ")}>
      <div className="flex w-max min-w-full flex-nowrap items-center gap-1.5">
        {volumes.map((volume, index) => {
          return (
            <span key={volume.key} className="contents">
              {index > 0 && <span className="shrink-0 text-white/35">→</span>}
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-1">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[9px] font-semibold text-white/55">
                  {index + 1}
                </span>
                <TrafficVolumeInfoTooltip
                  trafficVolumeId={volume.trafficVolumeId}
                  className="inline-flex min-w-0"
                  tooltipClassName="z-[12000]"
                >
                  <span className="max-w-[150px] truncate font-medium text-sky-100 underline decoration-white/20 underline-offset-2">
                    {volume.label}
                  </span>
                </TrafficVolumeInfoTooltip>
                {volume.windowLabel && <span className="shrink-0 font-mono text-white/45">{volume.windowLabel}</span>}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
