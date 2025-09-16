"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  fromFL?: number; // e.g., 0
  toFL?: number;   // e.g., 500
  minFL?: number;  // default 0
  maxFL?: number;  // default 500
  stepFL?: number; // default 10
  className?: string;
  onChange?: (from: number, to: number) => void;
  onCommit?: (from: number, to: number) => void;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export default function FlightLevelRangeControl({
  fromFL = 0,
  toFL = 500,
  minFL = 0,
  maxFL = 500,
  stepFL = 10,
  className,
  onChange,
  onCommit,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [from, setFrom] = useState(() => clamp(Math.round(fromFL), minFL, maxFL));
  const [to, setTo] = useState(() => clamp(Math.round(toFL), minFL, maxFL));

  // Keep internal state synced with props
  useEffect(() => {
    setFrom(clamp(Math.round(fromFL), minFL, maxFL));
  }, [fromFL, minFL, maxFL]);
  useEffect(() => {
    setTo(clamp(Math.round(toFL), minFL, maxFL));
  }, [toFL, minFL, maxFL]);

  useEffect(() => {
    onChange?.(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const span = Math.max(1, maxFL - minFL);
  const toPct = useCallback((v: number) => ((v - minFL) / span) * 100, [minFL, span]);

  const leftPct = useMemo(() => toPct(from), [from, toPct]);
  const rightPct = useMemo(() => toPct(to), [to, toPct]);

  type DragMode = null | "left" | "right" | "range";
  const dragState = useRef<{
    mode: DragMode;
    startX: number;
    startFrom: number;
    startTo: number;
    didDrag: boolean;
  }>({ mode: null, startX: 0, startFrom: 0, startTo: 0, didDrag: false });

  const flPerPx = useCallback(() => {
    const el = containerRef.current;
    if (!el) return stepFL;
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    return span / width;
  }, [span, stepFL]);

  const quantize = useCallback((v: number) => {
    const step = Math.max(1, Math.floor(stepFL));
    return Math.round(v / step) * step;
  }, [stepFL]);

  const beginDrag = (e: React.PointerEvent, mode: DragMode) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragState.current = { mode, startX: e.clientX, startFrom: from, startTo: to, didDrag: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = dragState.current;
    if (!st.mode) return;
    const fpp = flPerPx();
    const dx = e.clientX - st.startX;
    const dRaw = dx * fpp;
    const d = quantize(dRaw);

    if (!st.didDrag) {
      if (Math.abs(dx) >= 3 || Math.abs(d) > 0) st.didDrag = true;
    }

    if (st.mode === "left") {
      const nf = clamp(st.startFrom + d, minFL, to);
      setFrom(nf);
    } else if (st.mode === "right") {
      const nt = clamp(st.startTo + d, from, maxFL);
      setTo(nt);
    } else if (st.mode === "range") {
      let shift = d;
      shift = clamp(shift, minFL - st.startFrom, maxFL - st.startTo);
      setFrom(clamp(st.startFrom + shift, minFL, maxFL));
      setTo(clamp(st.startTo + shift, minFL, maxFL));
    }
  };

  const endDrag = () => {
    const st = dragState.current;
    if (!st.mode) return;
    st.mode = null;
    st.startFrom = from;
    st.startTo = to;
    onCommit?.(from, to);
  };

  const onTrackClick = (e: React.MouseEvent) => {
    const st = dragState.current;
    if (st.didDrag) {
      st.didDrag = false;
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const clickedFL = quantize(minFL + (x / rect.width) * span);
    if (Math.abs(clickedFL - from) < Math.abs(clickedFL - to)) {
      const nf = Math.min(clickedFL, to);
      setFrom(nf);
      onCommit?.(nf, to);
    } else {
      const nt = Math.max(clickedFL, from);
      setTo(nt);
      onCommit?.(from, nt);
    }
  };

  // Ticks and labels
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(Math.max(0, Math.floor(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const labelEvery = useMemo(() => {
    // choose label spacing to avoid clutter
    const pxPerUnit = containerWidth > 0 ? containerWidth / span : 0;
    const candidates = [50, 100, 200, 250];
    for (const s of candidates) {
      if (pxPerUnit * s >= 40) return s;
    }
    return 250;
  }, [containerWidth, span]);

  const ticks = useMemo(() => {
    const arr: number[] = [];
    const step = 50;
    for (let v = Math.ceil(minFL / step) * step; v <= maxFL; v += step) arr.push(v);
    return arr;
  }, [minFL, maxFL]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-[11px] text-white/80 mb-0">
        <span>From: <span className="font-mono">FL{from}</span></span>
        <span>To: <span className="font-mono">FL{to}</span></span>
      </div>
      <div className="select-none">
        <div
          ref={containerRef}
          className="relative h-4 rounded-lg bg-white/5 border border-white/10 overflow-hidden"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onMouseLeave={endDrag}
          onClick={onTrackClick}
          role="slider"
          aria-valuemin={minFL}
          aria-valuemax={maxFL}
          aria-valuenow={from}
        >
          {/* FL ticks */}
          <div className="absolute inset-0 pointer-events-none">
            {ticks.map((v) => {
              const pct = ((v - minFL) / span) * 100;
              const strong = v % 100 === 0;
              return (
                <div
                  key={`fl-${v}`}
                  className={strong ? "absolute top-0 bottom-0 border-r border-white/20" : "absolute top-0 bottom-0 border-r border-white/10"}
                  style={{ left: `${pct}%` }}
                />
              );
            })}
          </div>

          {/* Selected range */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-4 bg-blue-500/30 border border-blue-400/50 rounded-md cursor-grab active:cursor-grabbing"
            style={{ left: `${leftPct}%`, width: `${Math.max(0, rightPct - leftPct)}%` }}
            onPointerDown={(e) => beginDrag(e, "range")}
          />

          {/* Left handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-blue-400/80 border border-white/50 rounded shadow cursor-ew-resize"
            style={{ left: `${leftPct}%` }}
            onPointerDown={(e) => beginDrag(e, "left")}
            aria-label="Lower FL handle"
          />

          {/* Right handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-blue-400/80 border border-white/50 rounded shadow cursor-ew-resize"
            style={{ left: `${rightPct}%` }}
            onPointerDown={(e) => beginDrag(e, "right")}
            aria-label="Upper FL handle"
          />

          {/* Labels */}
          <div className="absolute bottom-0 left-0 right-0 text-[10px] text-white/70 pointer-events-none">
            {ticks.map((v) => (
              <div key={`lbl-${v}`} className="absolute" style={{ left: `${((v - minFL) / span) * 100}%`, transform: "translateX(-50%)" }}>
                {v % labelEvery === 0 ? `FL${v}` : ""}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


