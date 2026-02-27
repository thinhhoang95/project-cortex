"use client";

import { useMemo, useState } from "react";
import FlightQueryDialog from "@/components/FlightQueryDialog";
import { useSimStore, type RerouteCatcherMode, type RerouteCatcherTimeframe } from "@/components/useSimStore";

const TIMEFRAME_OPTIONS: Array<{ value: RerouteCatcherTimeframe; label: string }> = [
  { value: "15m", label: "15M" },
  { value: "30m", label: "30M" },
  { value: "45m", label: "45M" },
  { value: "1h", label: "1H" },
  { value: "2h", label: "2H" },
  { value: "3h", label: "3H" },
  { value: "4h", label: "4H" },
  { value: "all", label: "ALL" },
];

type RerouteIntelligentFlightSelectorPanelProps = {
  embedded?: boolean;
};

export default function RerouteIntelligentFlightSelectorPanel({ embedded = false }: RerouteIntelligentFlightSelectorPanelProps) {
  const {
    selectedTrafficVolume,
    selectedTrafficVolumes,
    rerouteTvBaselineFlightIds,
    rerouteCatcherMode,
    rerouteCatcherTimeframe,
    rerouteCatcherActive,
    setRerouteBaseFlightIds,
    setRerouteCatcherMode,
    setRerouteCatcherTimeframe,
    cancelRerouteCatcher,
  } = useSimStore();

  const [queryInput, setQueryInput] = useState("");
  const [queryInitialPrompt, setQueryInitialPrompt] = useState("");
  const [queryOpen, setQueryOpen] = useState(false);

  const baselineIds = useMemo(
    () => (rerouteTvBaselineFlightIds.length > 0 ? rerouteTvBaselineFlightIds : undefined),
    [rerouteTvBaselineFlightIds]
  );
  const isTvSelected = useMemo(() => {
    if (Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0) return true;
    return !!selectedTrafficVolume;
  }, [selectedTrafficVolumes, selectedTrafficVolume]);

  const toggleCatcherMode = (mode: Exclude<RerouteCatcherMode, "off">) => {
    if (rerouteCatcherMode === mode) {
      cancelRerouteCatcher();
      return;
    }
    setRerouteCatcherMode(mode);
  };

  const openQueryDialog = () => {
    const prompt = queryInput.trim();
    setQueryInitialPrompt(prompt);
    setQueryOpen(true);
  };
  const panelClassName = embedded
    ? "w-full max-w-[384px] mx-auto rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
    : "absolute top-20 right-4 z-50 min-w-[320px] max-w-[400px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col";

  return (
    <>
      <div className={panelClassName}>
        <div className="p-4 border-b border-white/20">
          <h2 className="font-semibold">Intelligent Flight Selector</h2>
          <p className="text-xs opacity-70 mt-1">Natural language query + flight catchers</p>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-white/10 border border-white/10 rounded-lg p-2">
            <div className="relative flex items-center gap-2">
              <input
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    openQueryDialog();
                  }
                }}
                placeholder="Describe flights to select"
                className="w-full px-3 py-2 pr-11 bg-white/10 border border-white/20 rounded-lg text-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/30"
              />
              <button
                type="button"
                onClick={openQueryDialog}
                className="absolute inset-y-0 right-2 flex items-center justify-center text-white/75 hover:text-white"
                title="Open flight query"
                aria-label="Open flight query"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M7 17 17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </button>
            </div>
            <p className="text-[11px] opacity-70 mt-2">
              {isTvSelected && baselineIds
                ? `Query always starts from the TV baseline (${baselineIds.length.toLocaleString("en-US")} flights).`
                : "Query builds a new base list from the currently visible flights."}
            </p>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Flight Catchers</h3>
              <div className="text-xs opacity-70">
                {rerouteCatcherActive ? "Drawing enabled" : "Drawing disabled"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <CatcherButton
                title="Positive Flight Catcher"
                active={rerouteCatcherMode === "include"}
                onClick={() => toggleCatcherMode("include")}
                kind="include"
              />
              <CatcherButton
                title="Negative Flight Catcher"
                active={rerouteCatcherMode === "exclude"}
                onClick={() => toggleCatcherMode("exclude")}
                kind="exclude"
              />
            </div>

            <div className="grid grid-cols-4 gap-2">
              {TIMEFRAME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRerouteCatcherTimeframe(option.value)}
                  className={`px-2 py-1.5 text-[11px] font-medium rounded border transition-colors ${
                    rerouteCatcherTimeframe === option.value
                      ? "bg-blue-500/30 border-blue-400/50 text-blue-200"
                      : "bg-white/10 border-white/20 text-white/80 hover:bg-white/15"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p className="text-[11px] opacity-75">
              {rerouteCatcherActive
                ? "Gate freezes at first click. Double-click to finish, Esc to cancel."
                : isTvSelected
                  ? "Choose a catcher mode, then draw to toggle flights visible at gate start within the TV baseline only."
                  : "Choose a catcher mode, then draw to add/remove flights visible and airborne at gate start."}
            </p>
          </div>
        </div>
      </div>

      <FlightQueryDialog
        open={queryOpen}
        onClose={() => setQueryOpen(false)}
        initialPrompt={queryInitialPrompt}
        flightIds={baselineIds}
        onSelectFlights={(flightIds) => {
          setRerouteBaseFlightIds(flightIds, "query");
          setQueryOpen(false);
        }}
        fullScreen
      />
    </>
  );
}

function CatcherButton(props: {
  title: string;
  active: boolean;
  onClick: () => void;
  kind: "include" | "exclude";
}) {
  const { title, active, onClick, kind } = props;
  const symbol = kind === "include" ? "+" : "−";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-3 rounded-lg border text-sm font-medium transition-colors inline-flex items-center gap-2 ${
        active
          ? kind === "include"
            ? "border-emerald-300/60 bg-emerald-500/25 text-emerald-100"
            : "border-rose-300/60 bg-rose-500/25 text-rose-100"
          : "border-white/20 bg-white/10 text-white/80 hover:bg-white/20"
      }`}
      title={title}
      aria-label={title}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="3 18 9 10 14 14 21 6" />
      </svg>
      <span className="text-base leading-none">{symbol}</span>
    </button>
  );
}
