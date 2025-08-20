"use client";
import { useSimStore } from "@/components/useSimStore";

export default function LeftControl1() {
  const { t, range, setRange, playing, setPlaying, speed, setSpeed, showFlightLineLabels, setShowFlightLineLabels, showCallsigns, setShowCallsigns, flLowerBound, flUpperBound, setFlLowerBound, setFlUpperBound } = useSimStore();
  return (
    <div className="absolute top-20 left-4 z-50 min-w-[280px] max-w-[360px]
                    rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
                    shadow-xl p-4 text-slate-900 text-white">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Time of day</h2>
        <button
          onClick={() => setPlaying(!playing)}
          className="px-3 py-1.5 rounded-xl border border-white/30 bg-white/30 hover:bg-white/40 text-sm"
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>

      <div className="text-sm mb-2 opacity-80">T = {fmt(t)} (speed {speed}×)</div>

      <input
        type="range"
        min={range[0]} max={range[1]} step={1}
        value={t}
        onChange={(e) => setRange([range[0], range[1]], Number(e.currentTarget.value))}
        className="w-full"
      />

      <div className="mt-3 flex items-center gap-2">
        <label className="text-sm">Speed</label>
        <select
          className="rounded-lg bg-white/50 px-2 py-1 text-sm"
          value={speed}
          onChange={(e) => setSpeed(Number(e.currentTarget.value))}
        >
          {[0.5,1,2,5,10].map(x => <option key={x} value={x}>{x}×</option>)}
        </select>
      </div>

      <div className="mt-6 pt-4 border-t border-white/20">
        <h2 className="font-semibold mb-3">View Options</h2>
        
        <div className="flex items-center justify-between">
          <label className="text-sm">Flight Line Labels</label>
          <button
            onClick={() => setShowFlightLineLabels(!showFlightLineLabels)}
            className={`px-3 py-1.5 rounded-xl border border-white/30 text-sm transition-colors ${
              showFlightLineLabels 
                ? "bg-white/40 hover:bg-white/50" 
                : "bg-white/20 hover:bg-white/30"
            }`}
          >
            {showFlightLineLabels ? "On" : "Off"}
          </button>
        </div>
        
        <div className="flex items-center justify-between mt-3">
          <label className="text-sm">Callsign</label>
          <button
            onClick={() => setShowCallsigns(!showCallsigns)}
            className={`px-3 py-1.5 rounded-xl border border-white/30 text-sm transition-colors ${
              showCallsigns 
                ? "bg-white/40 hover:bg-white/50" 
                : "bg-white/20 hover:bg-white/30"
            }`}
          >
            {showCallsigns ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-white/20">
        <h2 className="font-semibold mb-3">Airspace</h2>
        
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm">Lower FL</label>
              <span className="text-sm opacity-80">{flLowerBound}</span>
            </div>
            <input
              type="range"
              min={0}
              max={500}
              step={10}
              value={flLowerBound}
              onChange={(e) => setFlLowerBound(Number(e.currentTarget.value))}
              className="w-full"
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm">Upper FL</label>
              <span className="text-sm opacity-80">{flUpperBound}</span>
            </div>
            <input
              type="range"
              min={0}
              max={500}
              step={10}
              value={flUpperBound}
              onChange={(e) => setFlUpperBound(Number(e.currentTarget.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(sec: number) {
  const h = Math.floor(sec/3600).toString().padStart(2,"0");
  const m = Math.floor((sec%3600)/60).toString().padStart(2,"0");
  const s = Math.floor(sec%60).toString().padStart(2,"0");
  return `${h}:${m}:${s}`;
}