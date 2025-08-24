"use client";
import { useSimStore } from "@/components/useSimStore";
import { Trajectory } from "@/lib/models";
import { useEffect, useRef } from "react";

interface FlightDetailsPopupProps {
  flight: Trajectory | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export default function FlightDetailsPopup({ flight, position, onClose }: FlightDetailsPopupProps) {
  const { t } = useSimStore();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  // Close on outside simple click (not a drag), and on Escape key
  useEffect(() => {
    // Only attach listeners when popup is visible
    if (!flight || !position) return;

    let downPos: { x: number; y: number } | null = null;
    let startedInsidePanel = false;

    const isEventInsidePanel = (target: EventTarget | null) => {
      return !!(panelRef.current && target instanceof Node && panelRef.current.contains(target));
    };

    const handlePointerDown = (e: PointerEvent) => {
      startedInsidePanel = isEventInsidePanel(e.target);
      if (startedInsidePanel) return;
      downPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!downPos || startedInsidePanel) {
        downPos = null;
        startedInsidePanel = false;
        return;
      }
      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      const movedSq = dx * dx + dy * dy;
      // Only treat as a click if the pointer hasn't moved much (threshold ~10px)
      if (movedSq < 100) {
        onClose();
      }
      downPos = null;
      startedInsidePanel = false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [flight, position, onClose]);

  if (!flight || !position) return null;

  const takeoffTime = flight.t0;
  const elapsedTime = Math.max(0, t - takeoffTime);
  
  const origin = flight.origin || "Unknown";
  const destination = flight.destination || "Unknown";

  return (
    <>
      {/**
       * Allow map interactions while popup is open by removing the full-screen overlay
       * and handling outside-click via a document-level listener.
       */}
      {null}
      <div 
        className="fixed z-50 min-w-[280px] max-w-[360px]
                   rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
                   shadow-xl p-4 text-white"
        style={{
          left: position.x + 10,
          top: position.y + 10,
          transform: position.x > window.innerWidth / 2 ? 'translateX(-100%)' : 'none'
        }}
        ref={panelRef}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">Flight Details</h2>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded-lg border border-white/30 bg-white/20 hover:bg-white/30 text-sm transition-colors"
            title="Close panel"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="opacity-80">Call Sign:</span>
            <span className="font-medium">{flight.callSign || flight.flightId}</span>
          </div>
          
          <div className="flex justify-between">
            <span className="opacity-80">Origin:</span>
            <span className="font-medium">{origin}</span>
          </div>
          
          <div className="flex justify-between">
            <span className="opacity-80">Destination:</span>
            <span className="font-medium">{destination}</span>
          </div>
          
          <div className="border-t border-white/20 pt-2 mt-3">
            <div className="flex justify-between">
              <span className="opacity-80">Takeoff Time:</span>
              <span className="font-medium">{formatTime(takeoffTime)}</span>
            </div>
            
            <div className="flex justify-between">
              <span className="opacity-80">Elapsed Time:</span>
              <span className="font-medium">{formatTime(elapsedTime)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}