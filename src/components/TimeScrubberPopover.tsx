"use client";

import {
  useEffect,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { formatSecondsToHHMMSS } from "@/lib/time";

type TimeScrubberPopoverProps = {
  anchor: HTMLElement | null;
  open: boolean;
  value: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
};

type Position = {
  top: number;
  left: number;
};

const SLIDER_MIN = 0;
const SLIDER_MAX = 24 * 3600 - 1;
const SLIDER_STEP = 60;

export default function TimeScrubberPopover({
  anchor,
  open,
  value,
  onChange,
  onCommit,
}: TimeScrubberPopoverProps) {
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !anchor) {
      return;
    }

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      setPosition({
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX + rect.width / 2,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, open]);

  if (!mounted || !open || !anchor || !position) {
    return null;
  }

  const commitValue = (input: HTMLInputElement | null) => {
    if (!input) return;
    const nextValue = Number(input.value);
    onCommit(Number.isFinite(nextValue) ? nextValue : value);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number(event.currentTarget.value);
    onChange(Number.isFinite(nextValue) ? nextValue : value);
  };

  const handlePointerUp = (event: PointerEvent<HTMLInputElement>) => {
    commitValue(event.currentTarget);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    commitValue(event.currentTarget);
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "PageUp" ||
      event.key === "PageDown" ||
      event.key === "Enter"
    ) {
      commitValue(event.currentTarget);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        className="absolute pointer-events-auto"
        style={{ top: position.top, left: position.left }}
      >
        <div className="transform -translate-x-1/2 -translate-y-full -mt-3 px-3 py-2 rounded-xl border border-white/20 bg-white/[0.04] backdrop-blur-md shadow-lg">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={SLIDER_MIN}
              max={SLIDER_MAX}
              step={SLIDER_STEP}
              value={Math.floor(value)}
              onChange={handleChange}
              onPointerUp={handlePointerUp}
              onBlur={handleBlur}
              onKeyUp={handleKeyUp}
              className="w-[280px] h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-xs font-mono">{formatSecondsToHHMMSS(value)}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
