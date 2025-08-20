"use client";
import { useSimStore } from "@/components/useSimStore";
import { Trajectory } from "@/lib/models";

interface FlightDetailsPopupProps {
  flight: Trajectory | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export default function FlightDetailsPopup({ flight, position, onClose }: FlightDetailsPopupProps) {
  const { t } = useSimStore();

  if (!flight || !position) return null;

  const takeoffTime = flight.t0;
  const elapsedTime = Math.max(0, t - takeoffTime);
  
  const origin = flight.origin || "Unknown";
  const destination = flight.destination || "Unknown";

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  return (
    <>
      <div 
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      <div 
        className="fixed z-50 min-w-[280px] max-w-[360px]
                   rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
                   shadow-xl p-4 text-white"
        style={{
          left: position.x + 10,
          top: position.y + 10,
          transform: position.x > window.innerWidth / 2 ? 'translateX(-100%)' : 'none'
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">Flight Details</h2>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded-lg border border-white/30 bg-white/30 hover:bg-white/40 text-sm"
          >
            ×
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