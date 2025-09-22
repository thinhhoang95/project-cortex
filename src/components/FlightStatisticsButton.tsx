"use client";

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
};

export default function FlightStatisticsButton({
  flightIds,
  fullScreen = true,
  title = "Open flight statistics",
  ariaLabel = "Open flight statistics",
  buttonClassName,
  iconClassName = "h-3.5 w-3.5",
  disabled,
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
            />,
            portalTarget
          )
        : null}
    </>
  );
}

function StatsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M16.3891 8.11096L8.61091 15.8891"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.3891 8.11096L16.7426 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.3891 8.11096L12.5 7.75741"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
