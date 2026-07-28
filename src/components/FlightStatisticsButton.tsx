"use client";

import { ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import FlightStatisticsDialog from "@/components/FlightStatisticsDialog";

type FlightIdentifier = string | number | null | undefined;

type FlightStatisticsButtonProps = {
  flightIds: Iterable<FlightIdentifier> | null | undefined;
  fullScreen?: boolean;
  title?: string;
  ariaLabel?: string;
  buttonClassName?: string;
  iconClassName?: string;
  disabled?: boolean;
  sourceTrafficVolumeId?: string | null;
};

export default function FlightStatisticsButton({
  flightIds,
  fullScreen = true,
  title = "Open flight statistics",
  ariaLabel = "Open flight statistics",
  buttonClassName,
  iconClassName = "h-3.5 w-3.5",
  disabled,
  sourceTrafficVolumeId,
}: FlightStatisticsButtonProps) {
  const [open, setOpen] = useState(false);

  const normalizedFlightIds = useMemo(() => {
    if (!flightIds) return [] as string[];
    const collected: string[] = [];
    const seen = new Set<string>();
    for (const raw of flightIds) {
      if (raw === undefined || raw === null) continue;
      const normalized = String(raw).trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      collected.push(normalized);
    }
    return collected;
  }, [flightIds]);

  const isDisabled = disabled || normalizedFlightIds.length === 0;
  const portalTarget = typeof window === "undefined" ? null : document.body;

  const baseButtonClasses =
    "h-6 w-6 p-0 rounded border border-white/10 text-white/90 flex items-center justify-center hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <>
      <button
        type="button"
        className={`${baseButtonClasses}${buttonClassName ? ` ${buttonClassName}` : ""}`.trim()}
        title={title}
        aria-label={ariaLabel}
        onClick={() => {
          if (!isDisabled) setOpen(true);
        }}
        disabled={isDisabled}
        aria-disabled={isDisabled}
      >
        <StatsIcon className={iconClassName} />
      </button>
      {open && portalTarget
        ? createPortal(
            <FlightStatisticsDialog
              open={open}
              onClose={() => setOpen(false)}
              flightIds={normalizedFlightIds}
              fullScreen={fullScreen}
              sourceTrafficVolumeId={sourceTrafficVolumeId}
            />,
            portalTarget
          )
        : null}
    </>
  );
}

function StatsIcon({ className }: { className?: string }) {
  return (
    <ArrowUpRight className={className} aria-hidden="true" />
  );
}
