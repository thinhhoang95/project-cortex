"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  // Optional initial values in HH:MM (24h). Defaults to 00:00 and 23:59
  time_from?: string; // e.g. "07:30"
  time_to?: string;   // e.g. "18:15"
  // Fired whenever the selection changes (during drag as well)
  onChange?: (fromHHMM: string, toHHMM: string) => void;
  // Fired when user finishes a drag/interaction
  onCommit?: (fromHHMM: string, toHHMM: string) => void;
  className?: string;
  // Minute snapping granularity (default 1 minute)
  stepMinutes?: number;
};

const MINUTES_IN_DAY = 24 * 60; // 1440

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function hhmmToMinutes(hhmm?: string): number {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(":").map((x) => Number(x));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  const minutes = clamp(hh * 60 + mm, 0, MINUTES_IN_DAY - 1);
  return minutes;
}

function minutesToHHMM(totalMinutes: number): string {
  const m = clamp(Math.floor(totalMinutes), 0, MINUTES_IN_DAY - 1);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export default function TimeScaleControl({
  time_from = "00:00",
  time_to = "23:59",
  onChange,
  onCommit,
  className,
  stepMinutes = 1,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fromMin, setFromMin] = useState(() => hhmmToMinutes(time_from));
  const [toMin, setToMin] = useState(() => hhmmToMinutes(time_to));

  // Keep internal state in sync with external prop changes
  useEffect(() => {
    setFromMin(hhmmToMinutes(time_from));
  }, [time_from]);
  useEffect(() => {
    setToMin(hhmmToMinutes(time_to));
  }, [time_to]);

  // Emit change events
  useEffect(() => {
    onChange?.(minutesToHHMM(fromMin), minutesToHHMM(toMin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMin, toMin]);

  const leftPct = useMemo(() => (fromMin / (MINUTES_IN_DAY - 1)) * 100, [fromMin]);
  const rightPct = useMemo(() => (toMin / (MINUTES_IN_DAY - 1)) * 100, [toMin]);

  type DragMode = null | "left" | "right" | "range";
  const dragState = useRef<{
    mode: DragMode;
    startX: number;
    startFrom: number;
    startTo: number;
    pointerId?: number;
    // Tracks whether pointer moved enough to be considered a drag
    didDrag?: boolean;
  }>({ mode: null, startX: 0, startFrom: 0, startTo: 0, didDrag: false });

  const minutesPerPx = useCallback(() => {
    const el = containerRef.current;
    if (!el) return 1; // fallback
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    return (MINUTES_IN_DAY - 1) / width; // 1439 minutes across width
  }, []);

  const quantize = useCallback(
    (m: number) => {
      const step = Math.max(1, Math.floor(stepMinutes));
      return Math.round(m / step) * step;
    },
    [stepMinutes]
  );

  const beginDrag = (e: React.PointerEvent, mode: DragMode) => {
    const el = containerRef.current;
    if (!el) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragState.current = {
      mode,
      startX: e.clientX,
      startFrom: fromMin,
      startTo: toMin,
      pointerId: e.pointerId,
      didDrag: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = dragState.current;
    if (!st.mode) return;
    const mpp = minutesPerPx();
    const dx = e.clientX - st.startX;
    const dMinRaw = dx * mpp;
    const dMin = quantize(dMinRaw);

    // Mark as a drag once movement exceeds a small px threshold or quantized delta changes
    if (!st.didDrag) {
      if (Math.abs(dx) >= 3 || Math.abs(dMin) > 0) {
        st.didDrag = true;
      }
    }

    if (st.mode === "left") {
      const nf = clamp(st.startFrom + dMin, 0, toMin);
      setFromMin(nf);
    } else if (st.mode === "right") {
      const nt = clamp(st.startTo + dMin, fromMin, MINUTES_IN_DAY - 1);
      setToMin(nt);
    } else if (st.mode === "range") {
      // Move the whole range by the same delta to keep width constant
      // Use the already-quantized delta (dMin) and clamp the shift so both
      // ends remain within the day bounds without changing width.
      let shift = dMin;
      shift = clamp(shift, -st.startFrom, (MINUTES_IN_DAY - 1) - st.startTo);
      const nf = st.startFrom + shift;
      const nt = st.startTo + shift;
      setFromMin(nf);
      setToMin(nt);
    }
  };

  const endDrag = () => {
    if (!dragState.current.mode) return;
    dragState.current.mode = null;
    onCommit?.(minutesToHHMM(fromMin), minutesToHHMM(toMin));
  };

  // Click on track to move nearest edge
  const onTrackClick = (e: React.MouseEvent) => {
    // Suppress track click if the prior interaction was a drag to avoid
    // accidentally changing width after moving the range.
    if (dragState.current.didDrag) {
      dragState.current.didDrag = false;
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const mpp = minutesPerPx();
    const clickedMin = quantize(clamp(x * mpp, 0, MINUTES_IN_DAY - 1));
    let nf = fromMin;
    let nt = toMin;
    // Move the nearer handle
    if (Math.abs(clickedMin - fromMin) < Math.abs(clickedMin - toMin)) {
      nf = Math.min(clickedMin, toMin);
      setFromMin(nf);
    } else {
      nt = Math.max(clickedMin, fromMin);
      setToMin(nt);
    }
    onCommit?.(minutesToHHMM(nf), minutesToHHMM(nt));
  };

  // Keyboard support for focused handles
  const onKeyDown = (e: React.KeyboardEvent, handle: "left" | "right") => {
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -stepMinutes;
    if (e.key === "ArrowRight") delta = stepMinutes;
    if (delta === 0) return;
    e.preventDefault();
    if (handle === "left") {
      const nf = clamp(quantize(fromMin + delta), 0, toMin);
      setFromMin(nf);
      onCommit?.(minutesToHHMM(nf), minutesToHHMM(toMin));
    } else {
      const nt = clamp(quantize(toMin + delta), fromMin, MINUTES_IN_DAY - 1);
      setToMin(nt);
      onCommit?.(minutesToHHMM(fromMin), minutesToHHMM(nt));
    }
  };

  const hourTicks = useMemo(() => new Array(25).fill(0).map((_, i) => i), []);

  // Track container width to adapt tick density
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setContainerWidth(Math.max(0, Math.floor(rect.width)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Choose label spacing so labels don't clutter
  const labelEveryHours = useMemo(() => {
    const pxPerHour = containerWidth > 0 ? containerWidth / 24 : 0;
    const minPx = 48; // minimum pixels between labels
    const steps = [1, 2, 3, 4, 6, 8, 12, 24];
    for (const s of steps) {
      if (pxPerHour * s >= minPx) return s;
    }
    return 24;
  }, [containerWidth]);

  const showHalfHourTicks = useMemo(() => {
    const pxPerHour = containerWidth > 0 ? containerWidth / 24 : 0;
    return pxPerHour >= 80; // only if there is ample space
  }, [containerWidth]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-[11px] text-white/80 mb-1">
        <span>From: <span className="font-mono">{minutesToHHMM(fromMin)}</span></span>
        <span>To: <span className="font-mono">{minutesToHHMM(toMin)}</span></span>
      </div>
      <div className="select-none">
        <div
          ref={containerRef}
          className="relative h-10 rounded-lg bg-white/5 border border-white/10 overflow-hidden"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onMouseLeave={endDrag}
          onClick={onTrackClick}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={MINUTES_IN_DAY - 1}
          aria-valuenow={fromMin}
        >
          {/* Time ticks */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Hour lines */}
            {hourTicks.map((h) => {
              const pct = (h * 60) / MINUTES_IN_DAY * 100;
              const strong = h % 6 === 0; // emphasize every 6 hours
              return (
                <div
                  key={`h-${h}`}
                  className={strong ? "absolute top-0 bottom-0 border-r border-white/20" : "absolute top-0 bottom-0 border-r border-white/10"}
                  style={{ left: `${pct}%` }}
                />
              );
            })}
            {/* Optional half-hour short ticks when there's enough space */}
            {showHalfHourTicks && new Array(24).fill(0).map((_, i) => {
              const pct = (i * 60 + 30) / MINUTES_IN_DAY * 100;
              return (
                <div
                  key={`m-${i}`}
                  className="absolute border-r border-white/10"
                  style={{ left: `${pct}%`, top: 0, height: "10px" }}
                />
              );
            })}
          </div>

          {/* Selected range */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-6 bg-blue-500/30 border border-blue-400/50 rounded-md cursor-grab active:cursor-grabbing"
            style={{ left: `${leftPct}%`, width: `${Math.max(0, rightPct - leftPct)}%` }}
            onPointerDown={(e) => beginDrag(e, "range")}
          />

          {/* Left handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-8 bg-blue-400/80 border border-white/50 rounded shadow cursor-ew-resize"
            style={{ left: `${leftPct}%` }}
            onPointerDown={(e) => beginDrag(e, "left")}
            tabIndex={0}
            onKeyDown={(e) => onKeyDown(e, "left")}
            aria-label="Start time handle"
          />

          {/* Right handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-8 bg-blue-400/80 border border-white/50 rounded shadow cursor-ew-resize"
            style={{ left: `${rightPct}%` }}
            onPointerDown={(e) => beginDrag(e, "right")}
            tabIndex={0}
            onKeyDown={(e) => onKeyDown(e, "right")}
            aria-label="End time handle"
          />

          {/* Hour labels (adaptive density) */}
          <div className="absolute bottom-0 left-0 right-0 text-[10px] text-white/70 pointer-events-none">
            {hourTicks.map((h) => (
              <div
                key={`lbl-${h}`}
                className="absolute"
                style={{ left: `${(h * 60) / MINUTES_IN_DAY * 100}%`, transform: "translateX(-50%)" }}
              >
                {h % labelEveryHours === 0 ? `${String(h).padStart(2, "0")}:00` : ""}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
