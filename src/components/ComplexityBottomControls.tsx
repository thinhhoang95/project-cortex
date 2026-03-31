"use client";

import ResourceStateHistoryControl from "@/components/ResourceStateHistoryControl";
import ViewOptionsControl from "@/components/ViewOptionsControl";
import {
  getBottomControlsAnchorStyle,
  useBottomControlsAutoPosition,
} from "@/components/useBottomControlsAutoPosition";
import { useSimStore } from "@/components/useSimStore";

export default function ComplexityBottomControls() {
  const viewOptionsMinimized = useSimStore((state) => state.viewOptionsMinimized);
  const setViewOptionsMinimized = useSimStore((state) => state.setViewOptionsMinimized);
  const { anchorRef, offsetX } = useBottomControlsAutoPosition();

  return (
    <>
      <div
        ref={anchorRef}
        className="fixed left-1/2 bottom-0 z-40 pointer-events-none"
        style={getBottomControlsAnchorStyle(offsetX)}
      >
        <div
          className={`flex flex-col items-center gap-2 transition-all duration-300 ease-in-out ${
            viewOptionsMinimized
              ? "translate-y-full opacity-0 pointer-events-none"
              : "-translate-y-6 opacity-100 pointer-events-auto"
          }`}
        >
          <ResourceStateHistoryControl embedded />
          <ViewOptionsControl embedded lockedAirspaceDisplayMode="es" />
        </div>
      </div>
      <div
        className="fixed left-1/2 bottom-0 z-50 pointer-events-none"
        style={getBottomControlsAnchorStyle(offsetX)}
      >
        <button
          type="button"
          aria-label={viewOptionsMinimized ? "Expand bottom controls" : "Collapse bottom controls"}
          title={viewOptionsMinimized ? "Expand bottom controls" : "Collapse bottom controls"}
          onClick={() => setViewOptionsMinimized(!viewOptionsMinimized)}
          className="pointer-events-auto translate-y-1/2 hover:translate-y-0 focus-visible:translate-y-0 active:translate-y-0 w-10 h-10 rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/20 transition-all duration-300 ease-in-out shadow-lg flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className={`h-4 w-4 transition-transform duration-300 ease-in-out ${
              viewOptionsMinimized ? "-rotate-90" : "rotate-90"
            }`}
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
      </div>
    </>
  );
}
