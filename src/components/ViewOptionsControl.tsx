"use client";

import { ChevronDown, CloudRain, MapPin, MessageCircle, Share2, Square, Tag } from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import FlightLevelRangeControl from "@/components/FlightLevelRangeControl";
import FlightLineLabelPopover from "@/components/FlightLineLabelPopover";
import ResourceDateSelectorPanel from "@/components/ResourceDateSelectorPanel";
import ShimmeringText from "@/components/ShimmeringText";
import TimeScrubberPopover from "@/components/TimeScrubberPopover";
import {
  getBottomControlsAnchorStyle,
  useBottomControlsAutoPosition,
} from "@/components/useBottomControlsAutoPosition";
import { useSimStore } from "@/components/useSimStore";
import { resolveFlightLineLabelSelection } from "@/lib/flightLineLabels";
import { getDateDisplayParts } from "@/lib/resourceDates";
import { formatSecondsToHHMMSS } from "@/lib/time";
import { Slider } from "@/components/Slider";

type ViewOptionsControlProps = {
  embedded?: boolean;
  className?: string;
  showAirspaceDisplayToggle?: boolean;
  lockedAirspaceDisplayMode?: "tv" | "es";
};

export default function ViewOptionsControl({
  embedded = false,
  className,
  showAirspaceDisplayToggle = false,
  lockedAirspaceDisplayMode,
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
    flightLineLabelMode,
    setFlightLineLabelMode,
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
    viewOptionsMinimized,
  } = useSimStore();

  const { month, day } = useMemo(() => getDateDisplayParts(resourceDate), [resourceDate]);

  const [showTimeSeeker, setShowTimeSeeker] = useState(false);
  const [showDateSelector, setShowDateSelector] = useState(false);
  const [showFlightLineLabelPopover, setShowFlightLineLabelPopover] = useState(false);
  const timeButtonRef = useRef<HTMLButtonElement | null>(null);
  const flightLineLabelButtonRef = useRef<HTMLButtonElement | null>(null);
  const { anchorRef, offsetX } = useBottomControlsAutoPosition(!embedded);

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
      setShowFlightLineLabelPopover(false);
    }
  }, [minimized]);

  useEffect(() => {
    if (!lockedAirspaceDisplayMode) return;
    if (airspaceDisplayMode !== lockedAirspaceDisplayMode) {
      setAirspaceDisplayMode(lockedAirspaceDisplayMode);
    }
  }, [airspaceDisplayMode, lockedAirspaceDisplayMode, setAirspaceDisplayMode]);

  const handleFlightLineLabelModeSelect = (selectedMode: "callsign" | "flightLevel") => {
    const { nextMode, nextShowFlightLineLabels } = resolveFlightLineLabelSelection(
      flightLineLabelMode,
      showFlightLineLabels,
      selectedMode,
    );
    setFlightLineLabelMode(nextMode);
    setShowFlightLineLabels(nextShowFlightLineLabels);
    setShowFlightLineLabelPopover(false);
  };

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
                setShowFlightLineLabelPopover(false);
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
              onClick={() => {
                setShowFlightLineLabelPopover(false);
                setShowTimeSeeker((v) => !v);
              }}
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
            <CloudRain className="w-5 h-5 text-white/90" strokeWidth="2" aria-hidden="true" />
            {/* Sleek dropdown: no border, custom chevron */}
            <div className="relative inline-flex items-center">
              <select
                className="appearance-none bg-transparent border-0 text-white/90 hover:text-white pr-6 pl-1 py-1 text-xs focus:outline-none focus:ring-0"
                value={weatherOverlay}
                onChange={(e) => setWeatherOverlay(e.currentTarget.value as any)}
                aria-label="Weather Overlay"
                title="Weather Overlay"
              >
                <option className="bg-slate-800 text-white" value="none">Weather Overlay</option>
                <option className="bg-slate-800 text-white" value="surface-precip">Surface Precip.</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 mr-0.5 w-4 h-4 text-white/70" aria-hidden="true" />
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
            <Square className="w-5 h-5" />
          </IconToggle>

          <IconToggle
            title="Flight Lines"
            active={showFlightLines}
            onClick={() => setShowFlightLines(!showFlightLines)}
          >
            <Share2 className="w-5 h-5" />
          </IconToggle>

          <button
            ref={flightLineLabelButtonRef}
            type="button"
            aria-pressed={showFlightLineLabels}
            aria-expanded={showFlightLineLabelPopover}
            aria-haspopup="dialog"
            title="Flight Line Labels"
            onClick={() => {
              setShowTimeSeeker(false);
              setShowDateSelector(false);
              setShowFlightLineLabelPopover((value) => !value);
            }}
            className={
              `w-10 h-10 rounded-full flex items-center justify-center transition-colors ` +
              (showFlightLineLabels ? "text-blue-400" : "text-white/80 hover:text-white")
            }
          >
            <span className="sr-only">Flight Line Labels</span>
            <Tag className="w-5 h-5" />
          </button>

          <IconToggle
            title="Callsign"
            active={showCallsigns}
            onClick={() => setShowCallsigns(!showCallsigns)}
          >
            <MessageCircle className="w-5 h-5" />
          </IconToggle>

          <IconToggle
            title="Waypoints"
            active={showWaypoints}
            onClick={() => setShowWaypoints(!showWaypoints)}
          >
            <MapPin className="w-5 h-5" />
          </IconToggle>

          {(showAirspaceDisplayToggle || lockedAirspaceDisplayMode) && (
            <button
              type="button"
              title={
                lockedAirspaceDisplayMode
                  ? lockedAirspaceDisplayMode === "es"
                    ? "Locked to Collapsed Sectors"
                    : "Locked to Traffic Volumes"
                  : airspaceDisplayMode === "tv"
                    ? "Switch to Collapsed Sectors"
                    : "Switch to Traffic Volumes"
              }
              aria-label={
                lockedAirspaceDisplayMode
                  ? lockedAirspaceDisplayMode === "es"
                    ? "Locked to Collapsed Sectors"
                    : "Locked to Traffic Volumes"
                  : airspaceDisplayMode === "tv"
                    ? "Switch to Collapsed Sectors"
                    : "Switch to Traffic Volumes"
              }
              onClick={() => {
                if (lockedAirspaceDisplayMode) return;
                setAirspaceDisplayMode(airspaceDisplayMode === "tv" ? "es" : "tv");
              }}
              disabled={!!lockedAirspaceDisplayMode}
              className={
                `h-10 px-3 rounded-full text-xs font-semibold tracking-wide transition-colors ` +
                ((lockedAirspaceDisplayMode ?? airspaceDisplayMode) === "es"
                  ? "text-blue-400"
                  : "text-white/80 hover:text-white") +
                (lockedAirspaceDisplayMode ? " cursor-default opacity-80" : "")
              }
            >
              {(lockedAirspaceDisplayMode ?? airspaceDisplayMode) === "tv" ? "TV" : "CS"}
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

  const flightLineLabelPopover = (
    <FlightLineLabelPopover
      anchor={flightLineLabelButtonRef.current}
      open={showFlightLineLabelPopover}
      mode={flightLineLabelMode}
      onSelect={handleFlightLineLabelModeSelect}
      onClose={() => setShowFlightLineLabelPopover(false)}
    />
  );

  if (embedded) {
    return (
      <>
        {panelCard}
        {timeScrubberPopover}
        {flightLineLabelPopover}
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
      {flightLineLabelPopover}
      <ResourceDateSelectorPanel
        open={showDateSelector}
        onClose={() => setShowDateSelector(false)}
        onComplete={() => setShowDateSelector(false)}
      />
      <div
        ref={anchorRef}
        className="fixed left-1/2 bottom-0 z-40 pointer-events-none"
        style={getBottomControlsAnchorStyle(offsetX)}
      >
        <div
          className={`transform transition-all duration-300 ease-in-out ${minimized
              ? "translate-y-full opacity-0 pointer-events-none"
              : "-translate-y-6 opacity-100 pointer-events-auto"
            }`}
        >
          {panelCard}
        </div>
      </div>
    </>
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
