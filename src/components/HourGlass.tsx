"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * HourGlass — a glassy, rounded bar that visualizes value distribution as many thin vertical lines.
 *
 * Behavior
 * - Renders a glossy, rounded progress-bar-like strip where each datum is drawn as a tiny vertical line.
 * - Dense regions show many adjacent lines, allowing quick visual recognition of concentrations.
 * - Accepts numeric values or time strings (e.g. "08:00" or "08:00:20"). Time strings are converted to seconds-of-day.
 * - If no range is provided, it is inferred from the min/max of the parsed data.
 * - Optional labels show the left/right range values.
 *
 * Props
 * - data: Array<number | string | { value: number | string; color?: string; weight?: number }>
 *   - color is optional per-datum stroke color. If omitted, `defaultColor` is used.
 *   - weight (optional) scales the line height for that datum (1 = default height).
 * - range?: [number | string, number | string]
 *   - If omitted, computed from data min/max (after parsing).
 *   - May also be time strings (HH:MM or HH:MM:SS); converted to seconds-of-day.
 * - label?: boolean (default: true)
 *   - When true, min/max labels render below the bar.
 * - height?: number (default: 36)
 *   - Overall canvas height in CSS pixels (bar drawn within).
 * - className?: string
 * - style?: React.CSSProperties
 * - defaultColor?: string (default: "#22d3ee")
 * - lineWidth?: number (default: 1)
 * - lineHeightPct?: number (default: 0.6)
 *   - Fraction of bar height used for each vertical line.
 * - roundedRadius?: number (default: height/2)
 * - gloss?: boolean (default: true) — draw top gloss highlight.
 *
 * Usage examples
 *
 * 1) Numeric data, inferred range
 * ```tsx
 * import HourGlass from "@/components/HourGlass";
 *
 * const values = [1, 1.5, 2, 2, 2.2, 3.7, 4.1, 4.2, 5, 5.1, 6];
 *
 * <HourGlass data={values} />
 * ```
 *
 * 2) Time-of-day strings, inferred range
 * ```tsx
 * const arrivals = ["07:15", "07:20", "07:22", "07:59", "08:02", "08:03", "08:45", "09:10"]; 
 * <HourGlass data={arrivals} />
 * ```
 *
 * 3) Mixed objects with colors and time strings, explicit range
 * ```tsx
 * const points = [
 *   { value: "06:05", color: "#34d399" },
 *   { value: "06:07" },
 *   { value: "06:08", color: "#f59e0b" },
 *   { value: "06:10" },
 *   { value: "06:10:30", color: "#ef4444" }
 * ];
 * <HourGlass data={points} range={["06:00", "09:00"]} />
 * ```
 *
 * 4) Compact bar without labels, custom height and default color
 * ```tsx
 * <HourGlass data={[0.1,0.2,0.25,0.26,0.5,0.51,0.9]} label={false} height={24} defaultColor="#f472b6" />
 * ```
 */
export type PrimitiveValue = number | string;
export type HourGlassDatum = PrimitiveValue | { value: PrimitiveValue; color?: string; weight?: number };

export interface HourGlassProps {
  data: HourGlassDatum[];
  range?: [PrimitiveValue, PrimitiveValue];
  label?: boolean;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  defaultColor?: string;
  lineWidth?: number;
  lineHeightPct?: number;
  roundedRadius?: number;
  gloss?: boolean;
}

export default function HourGlass({
  data,
  range,
  label = true,
  height = 24,
  className,
  style,
  defaultColor = "#22d3ee",
  lineWidth = 1,
  lineHeightPct = 0.6,
  roundedRadius,
  gloss = false
}: HourGlassProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState<number>(300);
  const markersRef = useRef<Array<{ x: number; value: number }>>([]);
  const [hoverState, setHoverState] = useState<{ x: number; y: number; value: number } | null>(null);
  const mergedStyle = useMemo<React.CSSProperties>(() => ({ ...style, position: style?.position ?? 'relative' }), [style]);

  // Parse input data into numeric seconds/numbers and maintain any color/weight
  const parsed = useMemo(() => parseData(data), [data]);

  // Determine if the data/range appears to be time-like (any colon-based string before parsing)
  const timeLike = useMemo(() => isTimeLikeData(data) || isTimeLikeRange(range), [data, range]);

  // Compute numeric range
  const [minVal, maxVal] = useMemo(() => {
    const [r0, r1] = parseRange(range, parsed);
    // widen if equal to avoid division by zero
    if (r0 === r1) return [r0 - 1, r1 + 1] as const;
    return [r0, r1] as const;
  }, [range, parsed]);

  // Responsive width
  useEffect(() => {
    if (!containerRef.current) return;
    const elem = containerRef.current;
    const ro = new ResizeObserver(() => {
      setWidth(elem.clientWidth || 300);
    });
    ro.observe(elem);
    setWidth(elem.clientWidth || 300);
    return () => ro.disconnect();
  }, []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const cssWidth = Math.max(10, width);
    const cssHeight = Math.max(10, height);
    // Physical pixels
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr); // work in CSS pixels
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const radius = roundedRadius ?? Math.min(cssHeight / 2, 18);
    const padding = 0; // no outer padding
    const left = padding;
    const top = padding;
    const right = cssWidth - padding;
    const bottom = cssHeight - padding;

    // Bar path
    const barPath = new Path2D();
    roundedRectPath(barPath, left, top, right - left, bottom - top, radius);

    // Flat subtle background (reduced 3D)
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill(barPath);

    // Clip to the bar before drawing lines
    ctx.save();
    ctx.clip(barPath);

    // Compute line bounds
    const usableWidth = right - left;
    const barHeight = bottom - top;
    const lineHeight = Math.max(2, Math.min(barHeight - 4, Math.floor(barHeight * lineHeightPct)));
    const lineTop = top + (barHeight - lineHeight) / 2;
    const lineBottom = lineTop + lineHeight;

    // Draw each datum as a vertical line
    ctx.lineWidth = Math.max(0.5, lineWidth);
    ctx.lineCap = "round";
    const x0 = left + radius; // keep clear of rounded edges
    const x1 = right - radius;
    const span = Math.max(1e-6, maxVal - minVal);
    markersRef.current = [];
    for (const d of parsed) {
      const t = (d.value - minVal) / span;
      const x = x0 + t * Math.max(1, (x1 - x0));
      // Weight scales vertical extent around center
      const w = isFiniteNumber(d.weight) ? Math.max(0.1, d.weight!) : 1;
      const mid = (lineTop + lineBottom) / 2;
      const half = (lineHeight / 2) * w;
      const y0Line = Math.max(top + 2, mid - half);
      const y1Line = Math.min(bottom - 2, mid + half);
      ctx.beginPath();
      ctx.strokeStyle = d.color || defaultColor;
      ctx.moveTo(x, y0Line);
      ctx.lineTo(x, y1Line);
      ctx.stroke();
      markersRef.current.push({ x, value: d.value });
    }

    // No glossy highlight for a flatter look

    ctx.restore(); // clip
    ctx.restore(); // scale
  }, [width, height, roundedRadius, parsed, minVal, maxVal, defaultColor, lineWidth, lineHeightPct, gloss]);

  // Hover handlers for tooltip
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // Find nearest marker by x within a small radius
    const markers = markersRef.current;
    if (!markers || markers.length === 0) { setHoverState(null); return; }
    let bestIdx = -1;
    let bestDx = Infinity;
    for (let i = 0; i < markers.length; i++) {
      const dx = Math.abs(markers[i].x - px);
      if (dx < bestDx) { bestDx = dx; bestIdx = i; }
    }
    if (bestIdx !== -1 && bestDx <= 6) {
      setHoverState({ x: px, y: py, value: markers[bestIdx].value });
    } else {
      setHoverState(null);
    }
  }

  function handleMouseLeave() { setHoverState(null); }

  return (
    <div ref={containerRef} className={className} style={mergedStyle}>
      <canvas ref={canvasRef} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
      {hoverState && (
        <div
          style={{
            position: "absolute",
            left: Math.round(hoverState.x) + 8,
            top: Math.round(hoverState.y) - 24,
            transform: "translateY(-100%)",
            pointerEvents: "none",
            background: "rgba(15,23,42,0.9)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: "4px 6px",
            fontSize: 11,
            color: "#fff",
            whiteSpace: "nowrap",
            zIndex: 10
          }}
        >
          {timeLike ? formatSecondsToHHMM(hoverState.value) : formatNumber(hoverState.value)}
        </div>
      )}
      {label && (
        <div className="mt-1 text-[10px] text-white/80 flex items-center justify-between">
          <span>{timeLike ? formatSecondsToHHMM(minVal) : formatNumber(minVal)}</span>
          <span>{timeLike ? formatSecondsToHHMM(maxVal) : formatNumber(maxVal)}</span>
        </div>
      )}
    </div>
  );
}

// Helpers
function parseData(input: HourGlassDatum[]): Array<{ value: number; color?: string; weight?: number }> {
  const out: Array<{ value: number; color?: string; weight?: number }> = [];
  for (const d of input || []) {
    if (typeof d === "number" || typeof d === "string") {
      const v = parsePrimitiveToNumber(d);
      if (v != null && isFiniteNumber(v)) out.push({ value: v });
    } else if (d && typeof d === "object") {
      const v = parsePrimitiveToNumber(d.value);
      if (v != null && isFiniteNumber(v)) out.push({ value: v, color: d.color, weight: d.weight });
    }
  }
  return out;
}

function parseRange(range: HourGlassProps["range"], parsed: ReturnType<typeof parseData>): [number, number] {
  if (range && range.length === 2) {
    const a = parsePrimitiveToNumber(range[0]);
    const b = parsePrimitiveToNumber(range[1]);
    if (a != null && b != null) return [Math.min(a, b), Math.max(a, b)];
  }
  if (parsed.length === 0) return [0, 1];
  let min = parsed[0].value;
  let max = parsed[0].value;
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].value < min) min = parsed[i].value;
    if (parsed[i].value > max) max = parsed[i].value;
  }
  return [min, max];
}

function parsePrimitiveToNumber(v: PrimitiveValue): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    // time-like HH:MM or HH:MM:SS
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
      return timeStringToSeconds(s);
    }
    // try float
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isTimeLikeData(input: HourGlassDatum[]): boolean {
  for (const d of input || []) {
    const v = typeof d === "object" && d !== null ? (d as any).value : d;
    if (typeof v === "string" && v.includes(":")) return true;
  }
  return false;
}

function isTimeLikeRange(range?: [PrimitiveValue, PrimitiveValue]): boolean {
  if (!range) return false;
  const [a, b] = range;
  return (typeof a === "string" && a.includes(":")) || (typeof b === "string" && b.includes(":"));
}

function timeStringToSeconds(s: string): number {
  // Accept HH:MM or HH:MM:SS
  const parts = s.split(":").map((p) => Number.parseInt(p, 10));
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const sec = parts[2] || 0;
  return h * 3600 + m * 60 + sec;
}

function formatSecondsToHHMM(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600) % 24;
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatNumber(n: number): string {
  // Compact display to avoid long decimals
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  if (Math.abs(n) >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function roundedRectPath(path: Path2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
  path.moveTo(x + rr, y);
  path.lineTo(x + w - rr, y);
  path.arcTo(x + w, y, x + w, y + rr, rr);
  path.lineTo(x + w, y + h - rr);
  path.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  path.lineTo(x + rr, y + h);
  path.arcTo(x, y + h, x, y + h - rr, rr);
  path.lineTo(x, y + rr);
  path.arcTo(x, y, x + rr, y, rr);
  path.closePath();
}


