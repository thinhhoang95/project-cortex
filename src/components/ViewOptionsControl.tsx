"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import FlightLevelRangeControl from "@/components/FlightLevelRangeControl";
import ResourceDateSelectorPanel from "@/components/ResourceDateSelectorPanel";
import ShimmeringText from "@/components/ShimmeringText";
import TimeScrubberPopover from "@/components/TimeScrubberPopover";
import { useSimStore } from "@/components/useSimStore";
import { getDateDisplayParts } from "@/lib/resourceDates";
import { formatSecondsToHHMMSS } from "@/lib/time";
import { Slider } from "@/components/Slider";

type ViewOptionsControlProps = {
  embedded?: boolean;
  className?: string;
  showAirspaceDisplayToggle?: boolean;
};

export default function ViewOptionsControl({
  embedded = false,
  className,
  showAirspaceDisplayToggle = false,
}: ViewOptionsControlProps) {
  const {
    t,
    range,
    setT,
    resourceDate,
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
    showTrafficVolumes,
    setShowTrafficVolumes,
    airspaceDisplayMode,
    setAirspaceDisplayMode,
    flLowerBound,
    flUpperBound,
    setFlRange,
    glanceHorizonMinutes,
    setGlanceHorizonMinutes,
    setViewOptionsMinimized,
    viewOptionsMinimized,
  } = useSimStore();

  const { month, day } = useMemo(() => getDateDisplayParts(resourceDate), [resourceDate]);

  const [showTimeSeeker, setShowTimeSeeker] = useState(false);
  const [showDateSelector, setShowDateSelector] = useState(false);
  const timeButtonRef = useRef<HTMLButtonElement | null>(null);

  const [localT, setLocalT] = useState(t);
  // Sync local state if global state changes (e.g., from playback)
  useEffect(() => {
    setLocalT(t);
  }, [t]);

  const minimized = embedded ? false : viewOptionsMinimized;

  useEffect(() => {
    if (minimized) {
      setShowTimeSeeker(false);
      setShowDateSelector(false);
    }
  }, [minimized]);

  const panelCard = (
    <div
      className={
        "rounded-2xl border border-white/10 bg-white/10 backdrop-blur-md shadow-xl text-white w-max " +
        (className ?? "")
      }
    >
      <div className="pl-6 pr-2 py-3 flex items-center gap-3 flex-nowrap whitespace-nowrap">
        {false && (
          <div className="flex items-center gap-2">
            <Slider
              min={0}
              max={24 * 3600 - 1}
              step={60}
              value={Math.floor(t)}
              onChange={(e) => setT(Number(e.currentTarget.value))}
              className="w-[240px]"
            />
            <span className="text-xs font-mono">{formatSecondsToHHMMSS(t)}</span>
          </div>
        )}
        {/* Left: Date & Time */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-start gap-0.5">
            <button
              type="button"
              className="leading-tight text-left"
              onClick={() => {
                setShowTimeSeeker(false);
                setShowDateSelector(true);
              }}
              aria-haspopup="dialog"
              title="Choose resource date"
            >
              {resourceDate ? (
                <div className="text-[10px] tracking-wider uppercase">
                  <span className="opacity-70">{month}</span> <span className="text-white/100 font-bold">{day}</span>
                </div>
              ) : (
                <ShimmeringText text="Loading date" className="text-[10px] tracking-wider uppercase" />
              )}
            </button>
            <button
              ref={timeButtonRef}
              type="button"
              className="leading-tight text-left"
              onClick={() => setShowTimeSeeker((v) => !v)}
              aria-expanded={showTimeSeeker}
              aria-haspopup="dialog"
              title="Click to toggle time seeker"
            >
              <div className="text-xl font-bold tabular-nums">
                {formatSecondsToHHMMSS(t)} <span className="text-xs opacity-70 ml-1">UTC</span>
              </div>
            </button>
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
        <div className="min-w-[180px] w-[180px]">
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
        <div className="flex items-center gap-1">
          <IconToggle
            title="Traffic Volumes"
            active={showTrafficVolumes}
            onClick={() => setShowTrafficVolumes(!showTrafficVolumes)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x={4} y={4} width={16} height={16} rx={2} ry={2} strokeWidth={2} />
            </svg>
          </IconToggle>

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

          {showAirspaceDisplayToggle && (
            <button
              type="button"
              title={airspaceDisplayMode === "tv" ? "Switch to Collapsed Sectors" : "Switch to Traffic Volumes"}
              aria-label={airspaceDisplayMode === "tv" ? "Switch to Collapsed Sectors" : "Switch to Traffic Volumes"}
              onClick={() => setAirspaceDisplayMode(airspaceDisplayMode === "tv" ? "es" : "tv")}
              className={
                `h-10 px-3 rounded-full text-xs font-semibold tracking-wide transition-colors ` +
                (airspaceDisplayMode === "es" ? "text-blue-400" : "text-white/80 hover:text-white")
              }
            >
              {airspaceDisplayMode === "tv" ? "TV" : "CS"}
            </button>
          )}
        </div>


      </div>
    </div>
  );

  const timeScrubberPopover = (
    <TimeScrubberPopover
      anchor={timeButtonRef.current}
      open={showTimeSeeker}
      value={localT}
      min={range[0]}
      max={range[1]}
      onChange={setLocalT}
      onCommit={(nextValue) => {
        setLocalT(nextValue);
        setT(nextValue);
      }}
      glanceHorizonMinutes={glanceHorizonMinutes}
      onGlanceHorizonChange={setGlanceHorizonMinutes}
    />
  );

  if (embedded) {
    return (
      <>
        {panelCard}
        {timeScrubberPopover}
        <ResourceDateSelectorPanel
          open={showDateSelector}
          onClose={() => setShowDateSelector(false)}
          onComplete={() => setShowDateSelector(false)}
        />
      </>
    );
  }

  return (
    <>
      {timeScrubberPopover}
      <ResourceDateSelectorPanel
        open={showDateSelector}
        onClose={() => setShowDateSelector(false)}
        onComplete={() => setShowDateSelector(false)}
      />
      <div className="fixed left-1/2 bottom-0 -translate-x-1/2 z-40 pointer-events-none">
        <div
          className={`transform transition-all duration-300 ease-in-out ${minimized
              ? "translate-y-full opacity-0 pointer-events-none"
              : "-translate-y-6 opacity-100 pointer-events-auto"
            }`}
        >
          {panelCard}
        </div>
      </div>
      <BottomPanelToggleButton
        minimized={minimized}
        onToggle={() => setViewOptionsMinimized(!minimized)}
      />
    </>
  );
}

function BottomPanelToggleButton({ minimized, onToggle }: { minimized: boolean; onToggle: () => void }) {
  const actionLabel = minimized ? "Expand view options" : "Collapse view options";
  const iconRotationClass = minimized ? "-rotate-90" : "rotate-90";

  return (
    <button
      type="button"
      aria-label={actionLabel}
      title={actionLabel}
      onClick={onToggle}
      className={`fixed left-1/2 bottom-0 z-50 -translate-x-1/2 translate-y-1/2 hover:translate-y-0 focus-visible:translate-y-0 active:translate-y-0 w-10 h-10 rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/20 transition-all duration-300 ease-in-out shadow-lg flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={`h-4 w-4 transition-transform duration-300 ease-in-out ${iconRotationClass}`}
        fill="none"
      >
        <path
          d="M9 5l7 7-7 7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
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
