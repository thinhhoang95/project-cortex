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

// Parse HH:MM:SS format to seconds with validation
function parseHHMMSSToSeconds(value?: string): number | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (hours > 23) return null;
  if (minutes > 59 || seconds > 59) return null;
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const SECONDS_PER_DAY = 24 * 3600 - 1;
  return Math.max(0, Math.min(SECONDS_PER_DAY, totalSeconds));
}

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
  const [timeInputValue, setTimeInputValue] = useState("");
  const [timeInputError, setTimeInputError] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync textbox value with prop value
  useEffect(() => {
    setTimeInputValue(formatSecondsToHHMMSS(value));
    setTimeInputError(false);
  }, [value]);

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

  const handleTimeInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTimeInputValue(event.target.value);
    setTimeInputError(false);
  };

  const handleTimeInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      const parsedSeconds = parseHHMMSSToSeconds(timeInputValue);
      if (parsedSeconds !== null) {
        onChange(parsedSeconds);
        onCommit(parsedSeconds);
        setTimeInputError(false);
      } else {
        setTimeInputError(true);
      }
    } else if (event.key === "Escape") {
      // Revert to current value on Escape
      setTimeInputValue(formatSecondsToHHMMSS(value));
      setTimeInputError(false);
      event.currentTarget.blur();
    }
  };

  const handleTimeInputBlur = () => {
    // Revert to current value on blur if there's an error or empty
    setTimeInputValue(formatSecondsToHHMMSS(value));
    setTimeInputError(false);
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
            <input
              type="text"
              value={timeInputValue}
              onChange={handleTimeInputChange}
              onKeyDown={handleTimeInputKeyDown}
              onBlur={handleTimeInputBlur}
              placeholder="HH:MM:SS"
              className={`text-xs font-mono px-2 py-1 rounded bg-white/10 border ${
                timeInputError ? "border-red-500" : "border-white/20"
              } focus:outline-none focus:border-white/40 w-20 text-center`}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
