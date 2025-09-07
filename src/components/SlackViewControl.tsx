"use client";
import { useSimStore } from "@/components/useSimStore";

export default function SlackViewControl() {
  const { slackMode, setSlackMode, setSlackSign, deltaMin, setDeltaMin, isFetchingSlack, viewOptionsMinimized } = useSimStore();
  
  return (
    <div className={`absolute ${viewOptionsMinimized ? 'bottom-16' : 'bottom-24'} left-1/2 -translate-x-1/2 transform bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-1 text-xs text-gray-200 flex items-center gap-1 shadow-md z-50`}>
      <span className="px-2 text-gray-300">Slack View</span>
      <div className="w-px h-4 bg-white/30"></div>
      <button
        onClick={() => setSlackMode('off')}
        className={`flex items-center gap-1 px-2 py-1 rounded-md ${slackMode === 'off' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-200'}`}
        title="Turn off slack overlay"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>
        <span>Off</span>
      </button>
      <button
        onClick={() => { setSlackSign('minus'); setSlackMode('minus'); }}
        className={`flex items-center gap-1 px-2 py-1 rounded-md ${slackMode === 'minus' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-200'}`}
        title="Shift backward in time (minus)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path></svg>
        <span>Minus</span>
      </button>
      <button
        onClick={() => { setSlackSign('plus'); setSlackMode('plus'); }}
        className={`flex items-center gap-1 px-2 py-1 rounded-md ${slackMode === 'plus' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-200'}`}
        title="Shift forward in time (plus)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
        <span>Plus</span>
      </button>
      <div className="w-px h-4 bg-white/30"></div>
      <span className="px-2 text-gray-300">Delay</span>
      <select
        value={deltaMin}
        onChange={(e) => setDeltaMin(Number(e.target.value))}
        className="bg-transparent text-white text-xs focus:outline-none pl-3 pr-1 py-1 rounded-md hover:bg-white/10"
        title="Additional shift in minutes"
      >
        {(() => {
          const opts: number[] = [];
          for (let m = -90; m <= 90; m += 10) opts.push(m);
          for (let m = -25; m <= 25; m += 5) opts.push(m);
          const uniqueSorted = Array.from(new Set(opts)).sort((a,b) => a - b);
          return uniqueSorted.map((m) => (
            <option key={m} value={m} className="bg-slate-800 text-white">{m}</option>
          ));
        })()}
      </select>
      {isFetchingSlack && (
        <div className="ml-2 h-2 w-2 rounded-full bg-white/70 animate-pulse" title="Loading slack..." />
      )}
    </div>
  );
}
