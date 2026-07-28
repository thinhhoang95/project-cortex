"use client";

import { ArrowUpRight, Check, Filter, Hexagon, Trash2, TrendingUp } from "lucide-react";
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
    rerouteShapeToolMode,
    rerouteObstacles,
    rerouteFunnels,
    rerouteSelectedShape,
    rerouteProgramGeometryResult,
    rerouteDraftMoveGeometryResult,
    rerouteGeometryComputing,
    reroutePreviewMode,
    setRerouteBaseFlightIds,
    setRerouteCatcherMode,
    setRerouteCatcherTimeframe,
    setRerouteShapeToolMode,
    toggleReroutePreviewMode,
    cancelRerouteCatcher,
    clearRerouteObstacles,
    clearRerouteFunnels,
    removeRerouteSelectedShape,
    commitRerouteDraftMove,
  } = useSimStore();

  const [queryInput, setQueryInput] = useState("");
  const [queryInitialPrompt, setQueryInitialPrompt] = useState("");
  const [queryOpen, setQueryOpen] = useState(false);

  const baselineIds = useMemo(
    () => (rerouteTvBaselineFlightIds.length > 0 ? rerouteTvBaselineFlightIds : undefined),
    [rerouteTvBaselineFlightIds]
  );
  const primaryTvId = useMemo(() => {
    if (Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0) {
      const normalized = String(selectedTrafficVolumes[0] ?? "").trim();
      return normalized.length > 0 ? normalized : null;
    }
    const normalized = String(selectedTrafficVolume ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }, [selectedTrafficVolume, selectedTrafficVolumes]);
  const isTvSelected = useMemo(() => {
    if (Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0) return true;
    return !!selectedTrafficVolume;
  }, [selectedTrafficVolumes, selectedTrafficVolume]);
  const hasReroutePreview = (rerouteProgramGeometryResult?.changedFlightCount ?? 0) > 0;
  const canCommitDraft = (rerouteDraftMoveGeometryResult?.changedFlightCount ?? 0) > 0 && !rerouteGeometryComputing;
  const currentPreviewLabel = reroutePreviewMode === "rerouted" ? "After reroute" : "Current paths";
  const draftWarnings = useMemo(
    () =>
      (rerouteDraftMoveGeometryResult?.diagnostics || []).flatMap((diagnostic) =>
        (diagnostic.warnings || []).map((warning) => `${diagnostic.flightId}: ${warning}`)
      ),
    [rerouteDraftMoveGeometryResult]
  );
  const visibleDraftWarnings = draftWarnings.slice(0, 3);

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
          <h2 className="font-semibold">Select and Reroute</h2>
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
                <ArrowUpRight width="18" height="18" strokeWidth="2" aria-hidden="true" />
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

          <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Reroute Tools</h3>
              <div className="text-xs opacity-70">
                {rerouteShapeToolMode === "off" ? "Inactive" : `Active: ${rerouteShapeToolMode}`}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setRerouteShapeToolMode(rerouteShapeToolMode === "obstacle" ? "off" : "obstacle")
                }
                className={`h-9 w-9 flex items-center justify-center rounded-lg border transition-colors ${
                  rerouteShapeToolMode === "obstacle"
                    ? "border-amber-300/60 bg-amber-500/25 text-amber-100"
                    : "border-white/20 bg-white/10 text-white/80 hover:bg-white/20"
                }`}
                title="Obstacle Tool"
                aria-label="Obstacle Tool"
              >
                <Hexagon width="18" height="18" strokeWidth="2" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setRerouteShapeToolMode(rerouteShapeToolMode === "funnel" ? "off" : "funnel")
                }
                className={`h-9 w-9 flex items-center justify-center rounded-lg border transition-colors ${
                  rerouteShapeToolMode === "funnel"
                    ? "border-cyan-300/60 bg-cyan-500/25 text-cyan-100"
                    : "border-white/20 bg-white/10 text-white/80 hover:bg-white/20"
                }`}
                title="Funnel Tool"
                aria-label="Funnel Tool"
              >
                <Filter width="18" height="18" strokeWidth="2" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={clearRerouteObstacles}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-white/20 bg-white/10 text-white/80 hover:bg-white/15 transition-colors"
              >
                <Trash2 width="14" height="14" strokeWidth="2" aria-hidden="true" />
                Clear Obstacles ({rerouteObstacles.length})
              </button>
              <button
                type="button"
                onClick={clearRerouteFunnels}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-white/20 bg-white/10 text-white/80 hover:bg-white/15 transition-colors"
              >
                <Trash2 width="14" height="14" strokeWidth="2" aria-hidden="true" />
                Clear Funnels ({rerouteFunnels.length})
              </button>
            </div>

            <div className="flex rounded-lg border border-white/20 p-1 bg-white/5 text-xs">
              <button
                type="button"
                onClick={() => {
                  if (reroutePreviewMode === "rerouted") toggleReroutePreviewMode();
                }}
                disabled={!hasReroutePreview}
                className={`flex-1 px-3 py-1.5 rounded-md transition-colors text-center ${
                  reroutePreviewMode !== "rerouted" && hasReroutePreview
                    ? "bg-amber-500/25 text-amber-100 font-medium shadow-sm"
                    : "text-white/60 hover:text-white/80 hover:bg-white/10"
                } ${!hasReroutePreview ? "cursor-not-allowed opacity-50" : ""}`}
              >
                Current Paths
              </button>
              <button
                type="button"
                onClick={() => {
                  if (reroutePreviewMode !== "rerouted") toggleReroutePreviewMode();
                }}
                disabled={!hasReroutePreview}
                className={`flex-1 px-3 py-1.5 rounded-md transition-colors text-center ${
                  reroutePreviewMode === "rerouted" && hasReroutePreview
                    ? "bg-emerald-500/25 text-emerald-100 font-medium shadow-sm"
                    : "text-white/60 hover:text-white/80 hover:bg-white/10"
                } ${!hasReroutePreview ? "cursor-not-allowed opacity-50" : ""}`}
              >
                After Reroute
              </button>
            </div>

            <button
              type="button"
              onClick={removeRerouteSelectedShape}
              disabled={!rerouteSelectedShape}
              className={`w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xs transition-colors ${
                rerouteSelectedShape
                  ? "border-rose-300/60 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30"
                  : "border-white/10 bg-white/5 text-white/45 cursor-not-allowed"
              }`}
            >
              <Trash2 width="14" height="14" strokeWidth="2" aria-hidden="true" />
              Delete Selected Shape
            </button>

            <p className="text-[11px] opacity-75">
              {rerouteShapeToolMode === "obstacle" &&
                "Obstacle: click to add vertices, double-click to close polygon, Esc to cancel draft."}
              {rerouteShapeToolMode === "funnel" &&
                "Funnel: click the affinity point, then draw the polygon that marks waypoints to dissolve. Double-click closes the polygon; flights already selected in the base list reroute from the last waypoint before the polygon to the first waypoint after it through the affinity point."}
              {rerouteShapeToolMode === "off" &&
                "Click a shape to select it, then press Delete/Backspace (or button) to remove it."}
            </p>

            <div className="text-[11px] opacity-75 border border-white/10 rounded p-2 bg-white/5">
              <div>Draft changed flights: {rerouteDraftMoveGeometryResult?.changedFlightCount ?? 0}</div>
              <div>Draft extra NM: {(rerouteDraftMoveGeometryResult?.totalExtraNm ?? 0).toLocaleString("en-US")}</div>
              <div>Preview mode: {currentPreviewLabel}</div>
              {visibleDraftWarnings.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-[10px] uppercase text-amber-200/80">Draft diagnostics</div>
                  {visibleDraftWarnings.map((warning) => (
                    <div key={warning} className="text-[11px] text-amber-100/90">
                      {warning}
                    </div>
                  ))}
                  {draftWarnings.length > visibleDraftWarnings.length && (
                    <div className="text-[11px] text-amber-100/75">
                      +{(draftWarnings.length - visibleDraftWarnings.length).toLocaleString("en-US")} more warnings
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                commitRerouteDraftMove();
              }}
              disabled={!canCommitDraft}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                canCommitDraft
                  ? "border-emerald-300/60 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/35"
                  : "border-white/10 bg-white/5 text-white/45 cursor-not-allowed"
              }`}
            >
              <Check width="16" height="16" strokeWidth="2" aria-hidden="true" />
              Commit Draft Move
            </button>
          </div>
        </div>
      </div>

      <FlightQueryDialog
        open={queryOpen}
        onClose={() => setQueryOpen(false)}
        initialPrompt={queryInitialPrompt}
        flightIds={baselineIds}
        sourceTrafficVolumeId={primaryTvId}
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
      <TrendingUp width="18" height="18" strokeWidth="2" aria-hidden="true" />
      <span className="text-base leading-none">{symbol}</span>
    </button>
  );
}
