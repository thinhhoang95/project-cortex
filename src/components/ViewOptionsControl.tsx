"use client";

import { useSimStore } from "@/components/useSimStore";
import { ReactNode, useMemo, useState, useEffect } from "react";
import TimeScaleControl from "@/components/TimeScaleControl";
import FlightLevelRangeControl from "@/components/FlightLevelRangeControl";

type ViewOptionsControlProps = {
  embedded?: boolean;
  className?: string;
};

export default function ViewOptionsControl({ embedded = false, className }: ViewOptionsControlProps) {
  const {
    t,
    setT,
    date,
    weatherOverlay,
    setWeatherOverlay,
    showFlightLineLabels,
    setShowFlightLineLabels,
    showCallsigns,
    setShowCallsigns,
    showFlightLines,
    setShowFlightLines,
    showWaypoints,
    setShowWaypoints,
    flLowerBound,
    flUpperBound,
    setFlRange,
    setViewOptionsMinimized,
  } = useSimStore();

  const { dow, month, day } = useMemo(() => formatDateParts(date), [date]);

  const [showTimeSeeker, setShowTimeSeeker] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const [localT, setLocalT] = useState(t);
  // Sync local state if global state changes (e.g., from playback)
  useEffect(() => {
    setLocalT(t);
  }, [t]);

  // If not embedded and minimized, render a small restore button near the bottom
  if (!embedded && minimized) {
    return (
      <button
        type="button"
        title="Expand View Options"
        aria-label="Expand View Options"
        onClick={() => { setMinimized(false); setViewOptionsMinimized(false); }}
        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 w-8 h-8 rounded-full border border-white/30 bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/15 flex items-center justify-center shadow-md"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* Clock Icon */}
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </button>
    );
  }

  return (
    <div
      className={
        `${embedded ? "" : "fixed bottom-6 left-1/2 -translate-x-1/2 z-30"} ` +
        "rounded-2xl border border-white/10 bg-white/10 backdrop-blur-md shadow-xl text-white w-max " +
        (className ?? "")
      }
    >
      <div className="px-4 py-3 flex items-center gap-4 flex-nowrap whitespace-nowrap">
        {false && (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={24 * 3600 - 1}
              step={60}
              value={Math.floor(t)}
              onChange={(e) => setT(Number(e.currentTarget.value))}
              className="w-[240px] h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-xs font-mono">{fmt(t)}</span>
          </div>
        )}
        {/* Left: Date, Time, Speed */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 leading-tight">
            <div className="text-[10px] tracking-wider uppercase opacity-80">{dow}, {month}</div>
            <div className="text-xl font-extrabold">{day}</div>
          </div>
          <div className="h-6 w-px bg-white/30" />
          <div className="relative">
            <button
              type="button"
              className="leading-tight text-left"
              onClick={() => setShowTimeSeeker(v => !v)}
              aria-expanded={showTimeSeeker}
              title="Click to toggle time seeker"
            >
              <div className="text-[10px] tracking-wider uppercase opacity-70">Operation Time</div>
              <div className="text-xl font-bold tabular-nums">
                {fmt(t)} <span className="text-xs opacity-70 ml-1">UTC</span>
              </div>
            </button>
            {showTimeSeeker && (
              <div className="absolute left-1/2 -translate-x-1/2 -top-12 z-50 px-3 py-2 rounded-xl border border-white/20 bg-slate-900/95 backdrop-blur-md shadow-lg">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={24 * 3600 - 1}
                    step={60}
                    value={Math.floor(localT)}
                    onChange={(e) => setLocalT(Number(e.currentTarget.value))}
                    onMouseUp={() => setT(localT)}
                    onTouchEnd={() => setT(localT)}
                    className="w-[280px] h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-xs font-mono">{fmt(localT)}</span>
                </div>
              </div>
            )}
          </div>
          <div className="h-6 w-px bg-white/30" />
          <div className="flex items-center gap-2">
            {/* Weather icon */}
            <svg className="w-5 h-5 text-white/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 17.58A5 5 0 0018 8h-1.26A8 8 0 104 16.25" />
              <path d="M8 19v2" />
              <path d="M12 19v2" />
              <path d="M16 19v2" />
            </svg>
            {/* Sleek dropdown: no border, custom chevron */}
            <div className="relative inline-flex items-center">
              <select
                className="appearance-none bg-transparent border-0 text-white/90 hover:text-white pr-6 pl-1 py-1 text-xs focus:outline-none focus:ring-0"
                value={weatherOverlay}
                onChange={(e) => setWeatherOverlay(e.currentTarget.value as any)}
                aria-label="Weather Overlay"
                title="Weather Overlay"
              >
                <option className="bg-slate-800 text-white" value="none">No Weather Overlay</option>
                <option className="bg-slate-800 text-white" value="surface-precip">Surface Precipitation</option>
              </select>
              <svg
                className="pointer-events-none absolute right-0 mr-0.5 w-4 h-4 text-white/70"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.25 8.29a.75.75 0 01-.02-1.08z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-white/40" />

        {/* Flight Level Range */}
        <div className="min-w-[240px] w-[240px]">
          <FlightLevelRangeControl
            className="w-full"
            fromFL={flLowerBound}
            toFL={flUpperBound}
            minFL={0}
            maxFL={500}
            stepFL={10}
            onCommit={(lo, hi) => setFlRange(lo, hi)}
          />
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-white/40" />

        {/* Right: Icon Toggles */}
        <div className="flex items-center gap-2">
          <IconToggle
            title="Flight Lines"
            active={showFlightLines}
            onClick={() => setShowFlightLines(!showFlightLines)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
            </svg>
          </IconToggle>

          <IconToggle
            title="Flight Line Labels"
            active={showFlightLineLabels}
            onClick={() => setShowFlightLineLabels(!showFlightLineLabels)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </IconToggle>

          <IconToggle
            title="Callsign"
            active={showCallsigns}
            onClick={() => setShowCallsigns(!showCallsigns)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </IconToggle>

          <IconToggle
            title="Waypoints"
            active={showWaypoints}
            onClick={() => setShowWaypoints(!showWaypoints)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </IconToggle>

          {/* Minimize button (circular with thin border) */}
          {!embedded && (
            <button
              type="button"
              title="Minimize"
              aria-label="Minimize"
              onClick={() => { setMinimized(true); setViewOptionsMinimized(true); }}
              className="w-9 h-9 mx-1 rounded-full border border-white/30 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-colors flex items-center justify-center"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14" />
              </svg>
            </button>
          )}
        </div>

        
      </div>
    </div>
  );
}

function IconToggle({ title, active, onClick, children }: { title: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={
        `w-10 h-10 rounded-full flex items-center justify-center transition-colors ` +
        (active ? "text-blue-400" : "text-white/80 hover:text-white")
      }
    >
      <span className="sr-only">{title}</span>
      {children}
    </button>
  );
}

function fmt(sec: number) {
  const h = Math.floor(sec / 3600).toString().padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatDateParts(dateStr: string) {
  try {
    const [ddStr, mmStr, yyyyStr] = dateStr.split("/");
    const dd = Number(ddStr);
    const mm = Number(mmStr);
    const yyyy = Number(yyyyStr);
    const jsDate = new Date(Date.UTC(yyyy, (mm || 1) - 1, dd || 1));
    const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const MONTHS = [
      "JANUARY",
      "FEBRUARY",
      "MARCH",
      "APRIL",
      "MAY",
      "JUNE",
      "JULY",
      "AUGUST",
      "SEPTEMBER",
      "OCTOBER",
      "NOVEMBER",
      "DECEMBER",
    ];
    const dow = DOW[jsDate.getUTCDay()];
    const month = MONTHS[(mm || 1) - 1];
    const day = String(dd || 1).padStart(2, "0");
    return { dow, month, day };
  } catch {
    return { dow: "MON", month: "JANUARY", day: "01" };
  }
}
