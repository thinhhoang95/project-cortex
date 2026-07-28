"use client";
import { Minus, Plus, X } from "lucide-react";
import { useEffect } from "react";
import { useSimStore } from "@/components/useSimStore";
import { isSlackOverlayEligible } from "@/lib/slackOverlay";

type SlackViewControlProps = {
  embedded?: boolean;
  className?: string;
};

export default function SlackViewControl({
  embedded = false,
  className,
}: SlackViewControlProps) {
  const {
    slackMode,
    setSlackMode,
    setSlackSign,
    deltaMin,
    setDeltaMin,
    isFetchingSlack,
    airspaceDisplayMode,
    selectedTrafficVolume,
    selectedTrafficVolumes,
    viewOptionsMinimized,
  } = useSimStore();

  const slackEligible = isSlackOverlayEligible({
    airspaceDisplayMode,
    selectedTrafficVolume,
    selectedTrafficVolumes,
  });

  useEffect(() => {
    if (!slackEligible && slackMode !== "off") {
      setSlackMode("off");
    }
  }, [slackEligible, slackMode, setSlackMode]);

  if (!slackEligible) return null;

  const controlButtonClass = (active: boolean, disabled: boolean) =>
    `flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
      disabled
        ? "text-gray-500 cursor-not-allowed"
        : active
          ? "bg-white/20 text-white"
          : "hover:bg-white/10 text-gray-200"
    }`;

  const containerClassName = embedded
    ? `bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-1 text-xs text-gray-200 flex items-center gap-1 shadow-md w-max ${className ?? ""}`
    : `absolute ${viewOptionsMinimized ? "bottom-16" : "bottom-24"} left-1/2 -translate-x-1/2 transform bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-1 text-xs text-gray-200 flex items-center gap-1 shadow-md z-47 ${className ?? ""}`;

  return (
    <div className={containerClassName}>
      <span className="px-2 text-gray-300">Slack View</span>
      <div className="w-px h-4 bg-white/30"></div>
      <button
        type="button"
        onClick={() => setSlackMode("off")}
        className={controlButtonClass(slackMode === "off", false)}
        title="Turn off slack overlay"
      >
        <X width="14" height="14" strokeWidth="2" />
        <span>Off</span>
      </button>
      <button
        type="button"
        onClick={() => { setSlackSign("minus"); setSlackMode("minus"); }}
        className={controlButtonClass(slackMode === "minus", false)}
        title="Shift backward in time (minus)"
      >
        <Minus width="14" height="14" strokeWidth="2" />
        <span>Minus</span>
      </button>
      <button
        type="button"
        onClick={() => { setSlackSign("plus"); setSlackMode("plus"); }}
        className={controlButtonClass(slackMode === "plus", false)}
        title="Shift forward in time (plus)"
      >
        <Plus width="14" height="14" strokeWidth="2" />
        <span>Plus</span>
      </button>
      <div className="w-px h-4 bg-white/30"></div>
      <span className="px-2 text-gray-300">Delay</span>
      <select
        value={deltaMin}
        onChange={(e) => setDeltaMin(Number(e.target.value))}
        className="bg-transparent text-xs focus:outline-none pl-3 pr-1 py-1 rounded-md text-white hover:bg-white/10"
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
