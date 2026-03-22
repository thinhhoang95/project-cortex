"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  type FlightLineLabelMode,
} from "@/lib/flightLineLabels";

type FlightLineLabelPopoverProps = {
  anchor: HTMLElement | null;
  open: boolean;
  mode: FlightLineLabelMode;
  onSelect: (mode: FlightLineLabelMode) => void;
  onClose: () => void;
};

type Position = {
  top: number;
  left: number;
};

const POPOVER_GAP_PX = 20;

export default function FlightLineLabelPopover({
  anchor,
  open,
  mode,
  onSelect,
  onClose,
}: FlightLineLabelPopoverProps) {
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !anchor) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const top = rect.top + window.scrollY - POPOVER_GAP_PX;
      const left = rect.left + window.scrollX + rect.width / 2;

      setPosition({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchor?.contains(target)) return;
      if ((target as HTMLElement | null)?.closest?.("[data-flight-line-label-popover]")) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchor, onClose, open]);

  if (!mounted || !open || !anchor || !position) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div className="absolute" style={{ top: position.top, left: position.left }}>
        <div
          data-flight-line-label-popover
          className="pointer-events-auto transform -translate-x-1/2 -translate-y-full px-2 py-2 rounded-xl border border-white/20 bg-white/[0.04] backdrop-blur-md shadow-lg"
        >
          <div className="flex items-center gap-2">
            <ModeButton
              label="Flight level"
              active={mode === "flightLevel"}
              onClick={() => onSelect("flightLevel")}
            >
              {/* Layers icon — represents altitude strata / flight levels */}
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 12 12 17 22 12" />
                <polyline points="2 17 12 22 22 17" />
              </svg>
            </ModeButton>
            <ModeButton
              label="Callsign"
              active={mode === "callsign"}
              onClick={() => onSelect("callsign")}
            >
              {/* ID card icon — represents aircraft callsign / identifier */}
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <circle cx="8" cy="12" r="2" />
                <line x1="13" y1="10" x2="20" y2="10" />
                <line x1="13" y1="14" x2="18" y2="14" />
              </svg>
            </ModeButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ModeButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
        active
          ? "border-white/40 bg-white/20 text-white"
          : "border-white/15 bg-transparent text-white/70 hover:border-white/30 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
