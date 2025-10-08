"use client";
import { useSimStore } from "@/components/useSimStore";
import { Trajectory } from "@/lib/models";
import { useEffect, useRef, useState } from "react";
import VerticalProfileChart from "@/components/VerticalProfileChart";

interface FlightDetailsPopupProps {
  flight: Trajectory | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export default function FlightDetailsPopup({ flight, position, onClose }: FlightDetailsPopupProps) {
  const { t } = useSimStore();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number | null;
    offsetX: number;
    offsetY: number;
  }>({ pointerId: null, offsetX: 0, offsetY: 0 });

  const resetDragState = () => {
    dragStateRef.current = { pointerId: null, offsetX: 0, offsetY: 0 };
  };
  const [currentPosition, setCurrentPosition] = useState<{ x: number; y: number } | null>(
    position ? { x: position.x + 10, y: position.y + 10 } : null
  );

  const clampToViewport = (x: number, y: number) => {
    const panel = panelRef.current;
    if (!panel) return { x, y };

    const rect = panel.getBoundingClientRect();
    const padding = 12;
    const maxX = Math.max(padding, window.innerWidth - rect.width - padding);
    const maxY = Math.max(padding, window.innerHeight - rect.height - padding);

    return {
      x: Math.min(Math.max(x, padding), maxX),
      y: Math.min(Math.max(y, padding), maxY)
    };
  };

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

  useEffect(() => {
    if (!flight || !position) {
      const panel = panelRef.current;
      const activePointerId = dragStateRef.current.pointerId;
      if (panel && activePointerId !== null && panel.hasPointerCapture?.(activePointerId)) {
        panel.releasePointerCapture(activePointerId);
      }
      resetDragState();
      setCurrentPosition(null);
      return;
    }

    const base = { x: position.x + 10, y: position.y + 10 };
    setCurrentPosition(base);

    const frame = window.requestAnimationFrame(() => {
      setCurrentPosition((prev) => {
        const panel = panelRef.current;
        const fallback = prev ?? base;
        if (!panel) return fallback;

        const rect = panel.getBoundingClientRect();
        let x = base.x;
        if (base.x + rect.width > window.innerWidth - 12) {
          x = position.x - rect.width - 10;
        }
        let y = base.y;
        if (base.y + rect.height > window.innerHeight - 12) {
          y = window.innerHeight - rect.height - 12;
        }
        if (x < 12) x = 12;
        if (y < 12) y = 12;
        return { x, y };
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [flight, position?.x, position?.y]);

  if (!flight || !position || !currentPosition) return null;

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
          left: currentPosition.x,
          top: currentPosition.y
        }}
        ref={panelRef}
        onPointerMove={(e) => {
          const state = dragStateRef.current;
          if (state.pointerId !== e.pointerId) return;
          const next = clampToViewport(e.clientX - state.offsetX, e.clientY - state.offsetY);
          setCurrentPosition(next);
        }}
        onPointerUp={(e) => {
          const panel = panelRef.current;
          if (dragStateRef.current.pointerId !== e.pointerId || !panel) return;
          panel.releasePointerCapture(e.pointerId);
          resetDragState();
        }}
        onPointerCancel={(e) => {
          const panel = panelRef.current;
          if (dragStateRef.current.pointerId !== e.pointerId || !panel) return;
          panel.releasePointerCapture(e.pointerId);
          resetDragState();
        }}
        onLostPointerCapture={() => {
          resetDragState();
        }}
      >
        <div
          className="flex items-center justify-between mb-3 cursor-move select-none"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const panel = panelRef.current;
            if (!panel) return;
            const target = e.target as HTMLElement;
            if (target.closest("button")) return;
            const rect = panel.getBoundingClientRect();
            dragStateRef.current = {
              pointerId: e.pointerId,
              offsetX: e.clientX - rect.left,
              offsetY: e.clientY - rect.top
            };
            panel.setPointerCapture(e.pointerId);
            e.preventDefault();
          }}
        >
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

          <div className="mt-3">
            <div className="rounded-lg bg-white/10 border border-white/20 p-2">
              <VerticalProfileChart flight={flight} currentTime={t} height={140} />
              <div className="mt-1 flex items-center justify-between text-[11px] opacity-80">
                <span>T+0</span>
                <span>Flight Level</span>
                <span>T+{formatTime(Math.max(0, flight.t1 - flight.t0))}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
