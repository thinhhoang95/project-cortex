"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useThemeStore } from "./useThemeStore";

export type TrafficOverloadDatum = {
  period: string;
  color?: string;
  metadata?: string[];
  label?: string;
};

export interface TrafficOverloadBarProps {
  fromTime?: string;
  toTime?: string;
  data: TrafficOverloadDatum[];
  className?: string;
  height?: number;
  style?: React.CSSProperties;
  showTime?: boolean;
}

type ParsedSegment = {
  id: string;
  start: number;
  end: number;
  widthPct: number;
  leftPct: number;
  centerPct: number;
  color: string;
  periodLabel: string;
  metadata: string[];
  label?: string;
};

const SECONDS_IN_DAY = 24 * 60 * 60;

const NAMED_COLORS: Record<string, string> = {
  red: "#f87171",
  orange: "#fb923c",
  amber: "#fbbf24",
  yellow: "#facc15",
  lime: "#bef264",
  green: "#34d399",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#22d3ee",
  blue: "#60a5fa",
  indigo: "#818cf8",
  violet: "#a78bfa",
  purple: "#c084fc",
  magenta: "#e879f9",
  pink: "#f472b6",
  rose: "#fb7185",
};

const LIGHT_COLOR_SCHEME = [
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#34d399",
  "#2dd4bf",
  "#60a5fa",
  "#a78bfa",
];

const DARK_COLOR_SCHEME = [
  "#fb7185",
  "#f97316",
  "#facc15",
  "#4ade80",
  "#22d3ee",
  "#38bdf8",
  "#c084fc",
];

function resolveColor(color: string | undefined, index: number, palette: readonly string[]): string {
  if (color) {
    const trimmed = color.trim();
    if (trimmed.startsWith("#") && (trimmed.length === 4 || trimmed.length === 7 || trimmed.length === 9)) {
      return trimmed;
    }
    const lower = trimmed.toLowerCase();
    if (NAMED_COLORS[lower]) {
      return NAMED_COLORS[lower];
    }
  }
  return palette[index % palette.length];
}

function parseTimeLike(value?: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (minutes > 59 || seconds > 59) return null;
  if (hours > 24) return null;
  if (hours === 24 && (minutes > 0 || seconds > 0)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTime(seconds: number): string {
  const clamped = Math.max(0, Math.min(SECONDS_IN_DAY, Math.round(seconds)));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  if (secs !== 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

function parsePeriod(period: string): [number, number] | null {
  const dash = period.indexOf("-");
  if (dash <= 0) return null;
  const startStr = period.slice(0, dash);
  const endStr = period.slice(dash + 1);
  const start = parseTimeLike(startStr);
  const end = parseTimeLike(endStr);
  if (start === null || end === null) return null;
  return [start, end];
}

export default function TrafficOverloadBar({
  fromTime,
  toTime,
  data,
  className,
  height = 12,
  style,
  showTime = false,
}: TrafficOverloadBarProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const theme = useThemeStore((state) => state.theme);
  const isDarkTheme = theme === "dark";

  const range = useMemo(() => {
    const start = parseTimeLike(fromTime) ?? 0;
    const end = parseTimeLike(toTime) ?? SECONDS_IN_DAY;
    if (end <= start) {
      return { start: 0, end: SECONDS_IN_DAY } as const;
    }
    return { start, end } as const;
  }, [fromTime, toTime]);

  const colorPalette = useMemo(() => (isDarkTheme ? DARK_COLOR_SCHEME : LIGHT_COLOR_SCHEME), [isDarkTheme]);

  const segments = useMemo<ParsedSegment[]>(() => {
    const span = Math.max(1, range.end - range.start);
    return data
      .map((item, index) => {
        const parsed = parsePeriod(item.period);
        if (!parsed) return null;
        let [start, end] = parsed;
        if (end <= start) return null;
        start = Math.max(range.start, start);
        end = Math.min(range.end, end);
        if (end <= start) return null;
        const relativeStart = (start - range.start) / span;
        const relativeEnd = (end - range.start) / span;
        const widthPct = (relativeEnd - relativeStart) * 100;
        const leftPct = relativeStart * 100;
        const centerPct = leftPct + widthPct / 2;
        const color = resolveColor(item.color, index, colorPalette);
        const metadata = Array.isArray(item.metadata) ? item.metadata.filter((m) => typeof m === "string" && m.trim().length > 0) : [];
        const periodLabel = `${formatTime(start)} - ${formatTime(end)}`;
        return {
          id: `${item.period}-${index}`,
          start,
          end,
          widthPct,
          leftPct,
          centerPct,
          color,
          metadata,
          periodLabel,
          label: item.label?.trim() || undefined,
        } satisfies ParsedSegment;
      })
      .filter((segment): segment is ParsedSegment => Boolean(segment));
  }, [colorPalette, data, range.end, range.start]);

  const activeSegment = activeIndex !== null ? segments[activeIndex] ?? null : null;

  useEffect(() => {
    if (!activeSegment) {
      setTooltipPos(null);
      return;
    }

    const updateTooltipPosition = () => {
      const el = barRef.current;
      if (!el) {
        setTooltipPos(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      const left = rect.left + (activeSegment.centerPct / 100) * rect.width;
      const top = rect.top;
      setTooltipPos({ left, top });
    };

    updateTooltipPosition();
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);

    return () => {
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [activeSegment]);

  const containerClasses = ["relative w-full select-none", className].filter(Boolean).join(" ");

  const clampedHeight = Math.max(8, Math.min(64, Math.floor(height)));

  type BarThemeTokens = {
    trackBg: string;
    trackBorder: string;
    trackShadow: string;
    timeLabel: string;
    tooltipBg: string;
    tooltipBorder: string;
    tooltipShadow: string;
    tooltipText: string;
    tooltipMuted: string;
    segmentActiveFilter: string;
    segmentInactiveFilter: string;
    segmentActiveOpacity: number;
    segmentInactiveOpacity: number;
  };

  const themeTokens: BarThemeTokens = isDarkTheme
    ? {
        trackBg: "rgba(15, 23, 42, 0.82)",
        trackBorder: "rgba(94, 106, 134, 0.52)",
        trackShadow: "0 16px 34px -18px rgba(2, 6, 23, 0.8)",
        timeLabel: "rgba(148, 163, 184, 0.82)",
        tooltipBg: "rgba(2, 6, 23, 0.95)",
        tooltipBorder: "rgba(94, 106, 134, 0.55)",
        tooltipShadow: "0 18px 38px -18px rgba(2, 6, 23, 0.85)",
        tooltipText: "#e2e8f0",
        tooltipMuted: "rgba(148, 163, 184, 0.78)",
        segmentActiveFilter: "brightness(1.15)",
        segmentInactiveFilter: "brightness(0.85)",
        segmentActiveOpacity: 0.92,
        segmentInactiveOpacity: 0.72,
      }
    : {
        trackBg: "rgba(255, 255, 255, 0.22)",
        trackBorder: "rgba(255, 255, 255, 0.28)",
        trackShadow: "0 16px 38px -18px rgba(15, 23, 42, 0.6)",
        timeLabel: "rgba(248, 250, 252, 0.78)",
        tooltipBg: "rgba(15, 23, 42, 0.94)",
        tooltipBorder: "rgba(255, 255, 255, 0.2)",
        tooltipShadow: "0 20px 40px -18px rgba(15, 23, 42, 0.65)",
        tooltipText: "#f8fafc",
        tooltipMuted: "rgba(226, 232, 240, 0.76)",
        segmentActiveFilter: "brightness(1.05)",
        segmentInactiveFilter: "brightness(0.95)",
        segmentActiveOpacity: 0.9,
        segmentInactiveOpacity: 0.68,
      };

  const trackStyle: React.CSSProperties = {
    height: clampedHeight,
    background: themeTokens.trackBg,
    border: `1px solid ${themeTokens.trackBorder}`,
    boxShadow: themeTokens.trackShadow,
  };

  const timeLabelStyle: React.CSSProperties = { color: themeTokens.timeLabel };

  const startLabel = showTime ? formatTime(range.start) : null;
  const endLabel = showTime ? formatTime(range.end) : null;

  return (
    <>
      <div className={containerClasses} style={style}>
        <div
          ref={barRef}
          className="relative w-full overflow-hidden rounded-full"
          style={trackStyle}
          onMouseLeave={() => setActiveIndex(null)}
        >
          {segments.map((segment, index) => (
            <div
              key={segment.id}
              className="absolute top-0 bottom-0 cursor-pointer transition-[filter,opacity,transform] duration-150"
              style={{
                left: `${segment.leftPct}%`,
                width: `${segment.widthPct}%`,
                minWidth: 2,
                backgroundColor: segment.color,
                filter: activeIndex === index ? themeTokens.segmentActiveFilter : themeTokens.segmentInactiveFilter,
                opacity: activeIndex === index ? themeTokens.segmentActiveOpacity : themeTokens.segmentInactiveOpacity,
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex((prev) => (prev === index ? null : prev))}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex((prev) => (prev === index ? null : prev))}
              role="button"
              tabIndex={0}
              aria-label={segment.label || segment.periodLabel}
            >
              <span className="sr-only">{segment.label || segment.periodLabel}</span>
            </div>
          ))}
        </div>
        {showTime && startLabel && endLabel && (
          <div className="mt-1 flex justify-between text-[11px]" style={timeLabelStyle}>
            <span>{startLabel}</span>
            <span>{endLabel}</span>
          </div>
        )}
      </div>
      {activeSegment && tooltipPos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 w-[min(260px,80vw)] rounded-xl px-4 py-3 text-[11px] backdrop-blur"
            style={{
              left: tooltipPos.left,
              top: tooltipPos.top,
              transform: "translate(-50%, calc(-100% - 8px))",
              background: themeTokens.tooltipBg,
              border: `1px solid ${themeTokens.tooltipBorder}`,
              boxShadow: themeTokens.tooltipShadow,
              color: themeTokens.tooltipText,
            }}
            role="status"
          >
            <div className="flex flex-col gap-1">
              <div className="text-[12px] font-medium" style={{ color: themeTokens.tooltipText }}>
                {activeSegment.label || "Traffic overload"}
              </div>
              <div style={{ color: themeTokens.tooltipMuted }}>{activeSegment.periodLabel}</div>
              {activeSegment.metadata.length > 0 && (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {activeSegment.metadata.map((line, idx) => (
                    <li key={`${activeSegment.id}-meta-${idx}`} style={{ color: themeTokens.tooltipText }}>
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
