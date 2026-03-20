"use client";
import { useEffect, useMemo } from "react";
import { useSimStore } from "@/components/useSimStore";

export default function SlackViewControl() {
  const {
    slackMode,
    setSlackMode,
    setSlackSign,
    deltaMin,
    setDeltaMin,
    isFetchingSlack,
    viewOptionsMinimized,
    airspaceDisplayMode,
    selectedTrafficVolume,
    selectedTrafficVolumes,
  } = useSimStore();

  const selectedTvIds = useMemo(
    () =>
      Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0
        ? selectedTrafficVolumes
        : selectedTrafficVolume
          ? [selectedTrafficVolume]
          : [],
    [selectedTrafficVolume, selectedTrafficVolumes],
  );
  const slackEligible = airspaceDisplayMode === "tv" && selectedTvIds.length === 1;

  useEffect(() => {
    if (!slackEligible && slackMode !== "off") {
      setSlackMode("off");
    }
  }, [slackEligible, slackMode, setSlackMode]);

  const controlButtonClass = (active: boolean, disabled: boolean) =>
    `flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
      disabled
        ? "text-gray-500 cursor-not-allowed"
        : active
          ? "bg-white/20 text-white"
          : "hover:bg-white/10 text-gray-200"
    }`;

  return (
    <div
      className={`absolute ${viewOptionsMinimized ? "bottom-16" : "bottom-24"} left-1/2 -translate-x-1/2 transform bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-1 text-xs text-gray-200 flex items-center gap-1 shadow-md z-47`}
    >
      <span className="px-2 text-gray-300">Slack View</span>
      {!slackEligible && (
        <>
          <div className="w-px h-4 bg-white/30" />
          <span className="px-2 text-gray-400">
            {airspaceDisplayMode !== "tv" ? "TV mode only" : "Select exactly 1 TV"}
          </span>
        </>
      )}
      <div className="w-px h-4 bg-white/30"></div>
      <button
        type="button"
        onClick={() => setSlackMode("off")}
        className={controlButtonClass(slackMode === "off", false)}
        title="Turn off slack overlay"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>
        <span>Off</span>
      </button>
      <button
        type="button"
        onClick={() => { setSlackSign("minus"); setSlackMode("minus"); }}
        className={controlButtonClass(slackMode === "minus", !slackEligible)}
        title={slackEligible ? "Shift backward in time (minus)" : "Slack view requires exactly one selected traffic volume"}
        disabled={!slackEligible}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path></svg>
        <span>Minus</span>
      </button>
      <button
        type="button"
        onClick={() => { setSlackSign("plus"); setSlackMode("plus"); }}
        className={controlButtonClass(slackMode === "plus", !slackEligible)}
        title={slackEligible ? "Shift forward in time (plus)" : "Slack view requires exactly one selected traffic volume"}
        disabled={!slackEligible}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
        <span>Plus</span>
      </button>
      <div className="w-px h-4 bg-white/30"></div>
      <span className="px-2 text-gray-300">Delay</span>
      <select
        value={deltaMin}
        onChange={(e) => setDeltaMin(Number(e.target.value))}
        className={`bg-transparent text-xs focus:outline-none pl-3 pr-1 py-1 rounded-md ${slackEligible ? "text-white hover:bg-white/10" : "text-gray-500 cursor-not-allowed"}`}
        title={slackEligible ? "Additional shift in minutes" : "Slack view requires exactly one selected traffic volume"}
        disabled={!slackEligible}
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
      {slackEligible && isFetchingSlack && (
        <div className="ml-2 h-2 w-2 rounded-full bg-white/70 animate-pulse" title="Loading slack..." />
      )}
    </div>
  );
}
