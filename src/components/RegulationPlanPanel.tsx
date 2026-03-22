"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSimStore } from "@/components/useSimStore";
import ShimmeringText from "@/components/ShimmeringText";
import ModalDialog from "./ModalDialog";
import { simulateRegulationPlan } from "@/lib/regulationPlanSimulation";
import {
  getRegulationContext,
  getRegulationTargetCount,
  normalizeFlightIdList,
  normalizeRegulationContext,
  resolveRegulationTargetLabels,
  sameRegulationContext,
} from "@/lib/regulationTargets";

type RegulationsState = ReturnType<typeof useSimStore.getState>["regulations"];

type SavedRegulationPlan = {
  id: string;
  label: string;
  savedAt: number;
  data: {
    regulations: RegulationsState;
  };
};

const REGULATION_PLAN_STORAGE_KEY = "regulation-plan-saves";

interface RegulationPlanPanelProps {
  isRegulationPanelOpen: boolean;
  embedded?: boolean;
}

export default function RegulationPlanPanel({ isRegulationPanelOpen, embedded = false }: RegulationPlanPanelProps) {
  const {
    regulations,
    removeRegulation,
    setRegulationEditPayload,
    setIsRegulationPanelOpen,
    setRegulationSimulationResult,
    setIsResultsOpen,
    flights,
    setT,
    resourceDate,
    resourceStateSelectedId,
    setFlightLinePreviewFlightIds,
  } = useSimStore();
  const [selectedRegulation, setSelectedRegulation] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveTimestamp, setSaveTimestamp] = useState<number | null>(null);
  const [loadSearch, setLoadSearch] = useState("");
  const [savedPlans, setSavedPlans] = useState<SavedRegulationPlan[]>([]);
  const hoverPreviewBaselineRef = useRef<Set<string> | null>(null);
  const hoveredRegulationIdRef = useRef<string | null>(null);

  const restoreHoveredFlightLinePreview = useCallback(() => {
    setFlightLinePreviewFlightIds(new Set(hoverPreviewBaselineRef.current ?? []));
    hoverPreviewBaselineRef.current = null;
    hoveredRegulationIdRef.current = null;
  }, [setFlightLinePreviewFlightIds]);

  useEffect(() => {
    setSavedPlans(loadSavedPlansFromStorage());
  }, []);

  useEffect(() => restoreHoveredFlightLinePreview, [restoreHoveredFlightLinePreview]);

  useEffect(() => {
    if (!isMinimized) return;
    restoreHoveredFlightLinePreview();
  }, [isMinimized, restoreHoveredFlightLinePreview]);

  useEffect(() => {
    if (!hoveredRegulationIdRef.current) return;
    const hoveredStillExists = regulations.some((reg) => reg.id === hoveredRegulationIdRef.current);
    if (hoveredStillExists) return;
    restoreHoveredFlightLinePreview();
  }, [regulations, restoreHoveredFlightLinePreview]);

  useEffect(() => {
    if (saveModalOpen) {
      const now = Date.now();
      setSaveTimestamp(now);
      setSaveError(null);
      setSaveLabel((prev) => {
        if (prev.trim()) return prev;
        return `Plan ${formatDateTime(now)}`;
      });
    } else {
      setSaveTimestamp(null);
    }
  }, [saveModalOpen]);

  useEffect(() => {
    if (loadModalOpen) {
      setLoadSearch("");
    }
  }, [loadModalOpen]);

  const totalFlights = useMemo(() => {
    return regulations.reduce((sum, r) => sum + getRegulationTargetCount(r), 0);
  }, [regulations]);

  const currentContext = useMemo(
    () => normalizeRegulationContext({ resourceDate, resourceStateId: resourceStateSelectedId }),
    [resourceDate, resourceStateSelectedId],
  );

  const filteredSavedPlans = useMemo(() => {
    const query = loadSearch.trim().toLowerCase();
    if (!query) return savedPlans;
    return savedPlans.filter((plan) => plan.label.toLowerCase().includes(query));
  }, [savedPlans, loadSearch]);

  const closeSaveModal = () => {
    setSaveModalOpen(false);
    setSaveError(null);
    setSaveLabel("");
  };

  const closeLoadModal = () => {
    setLoadModalOpen(false);
    setLoadSearch("");
  };

  const handleSavePlan = () => {
    setSaveError(null);
    const trimmed = saveLabel.trim();
    if (!trimmed) {
      setSaveError("Label is required");
      return;
    }
    const now = Date.now();
    const planData = {
      regulations: deepCopy(regulations),
    };
    const existingIndex = savedPlans.findIndex((plan) => plan.label.toLowerCase() === trimmed.toLowerCase());
    let nextPlans: SavedRegulationPlan[];
    if (existingIndex >= 0) {
      const existing = savedPlans[existingIndex];
      nextPlans = savedPlans.slice();
      nextPlans[existingIndex] = {
        ...existing,
        label: trimmed,
        savedAt: now,
        data: planData,
      };
    } else {
      const newPlan: SavedRegulationPlan = {
        id: `plan-${now}-${Math.floor(Math.random() * 1000)}`,
        label: trimmed,
        savedAt: now,
        data: planData,
      };
      nextPlans = [...savedPlans, newPlan];
    }
    const sortedPlans = nextPlans.slice().sort((a, b) => b.savedAt - a.savedAt);
    if (!persistSavedRegulationPlans(sortedPlans)) {
      setSaveError("Failed to save plan to local storage. Check your browser settings.");
      return;
    }
    setSavedPlans(sortedPlans);
    closeSaveModal();
  };

  const handleLoadPlan = (plan: SavedRegulationPlan) => {
    try {
      const clonedRegs = deepCopy(plan.data.regulations || []);
      useSimStore.setState({ regulations: clonedRegs });
      setSelectedRegulation(null);
      setRegulationSimulationResult(null);
      closeLoadModal();
    } catch (err) {
      console.warn("Failed to load saved regulation plan", err);
    }
  };

  const handleDeletePlan = (plan: SavedRegulationPlan) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Delete saved plan "${plan.label}"?`);
      if (!confirmed) return;
    }
    const next = savedPlans.filter((p) => p.id !== plan.id);
    if (!persistSavedRegulationPlans(next)) return;
    setSavedPlans(next);
  };

  function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
  }

  return (
    <>
      {saveModalOpen && (
        <ModalDialog
          open={saveModalOpen}
          onClose={closeSaveModal}
          title="Save Regulation Plan"
          description="Store the current regulations locally."
          width="w-[min(520px,95vw)]"
          height="h-auto max-h-[85vh]"
        >
          <div className="space-y-4 px-5 py-5">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-white/60">Plan label</span>
              <input
                value={saveLabel}
                onChange={(e) => {
                  setSaveLabel(e.currentTarget.value);
                  setSaveError(null);
                }}
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                placeholder="Morning regs for EDDF"
              />
            </label>
            {saveError && <div className="text-[11px] text-red-200">{saveError}</div>}
            <div className="text-[12px] text-white/70">
              {regulations.length} regulation{regulations.length === 1 ? "" : "s"} • {totalFlights} flight{totalFlights === 1 ? "" : "s"}
            </div>
            <div className="text-[12px] text-white/50">
              Timestamp: {formatDateTime(saveTimestamp ?? Date.now())}
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-4">
            <button
              onClick={closeSaveModal}
              className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={handleSavePlan}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2 text-sm font-medium text-white shadow hover:opacity-90"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              Save plan
            </button>
          </div>
        </ModalDialog>
      )}
      {loadModalOpen && (
        <ModalDialog
          open={loadModalOpen}
          onClose={closeLoadModal}
          title="Load Regulation Plan"
          description="Pick a saved plan to restore it into the regulation list."
          width="w-[min(880px,95vw)]"
          height="h-auto max-h-[85vh]"
        >
          <div className="border-b border-white/10 px-5 py-4">
            <div className="relative">
              <input
                value={loadSearch}
                onChange={(e) => setLoadSearch(e.currentTarget.value)}
                placeholder="Search saved plans..."
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              />
              <svg
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
              </svg>
            </div>
          </div>
          <div className="max-h-80 space-y-3 overflow-y-auto px-5 py-4">
            {filteredSavedPlans.length === 0 ? (
              <div className="text-xs text-white/60">
                {savedPlans.length === 0 ? "No plans saved yet. Save a regulation plan to load it later." : "No saved plans match your search."}
              </div>
            ) : (
              filteredSavedPlans.map((plan) => {
                const regulationCount = plan.data.regulations?.length || 0;
                const flightCount = (plan.data.regulations || []).reduce((sum, reg) => sum + getRegulationTargetCount(reg), 0);
                return (
                  <div key={plan.id} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-white">{plan.label}</div>
                      <div className="text-[11px] text-white/60">Saved {formatDateTime(plan.savedAt)}</div>
                      <div className="text-[11px] text-white/60">{regulationCount} regulation{regulationCount === 1 ? "" : "s"} • {flightCount} flight{flightCount === 1 ? "" : "s"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleLoadPlan(plan)}
                        className="rounded-lg border border-indigo-300/40 bg-indigo-500/30 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500/45"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeletePlan(plan)}
                        className="rounded-lg border border-white/15 bg-white/5 p-2 text-white/70 transition hover:border-red-300/40 hover:bg-red-500/20 hover:text-red-100"
                        title="Delete saved plan"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 7h12M9 7v10m6-10v10M4 7h16l-1 14H5L4 7zm5-3h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.5"/></svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-end border-t border-white/10 px-5 py-4">
            <button
              onClick={closeLoadModal}
              className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </ModalDialog>
      )}
      {isMinimized ? (
        <button
          onClick={() => setIsMinimized(false)}
          className="fixed z-[200] bottom-4 right-4 w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-lg border border-white/20 flex items-center justify-center hover:opacity-90"
          title={`Show Regulation Plan (${regulations.length})`}
          aria-label="Show Regulation Plan"
        >
          <span className="text-sm font-semibold">{regulations.length}</span>
        </button>
      ) : (
        <div
          className={embedded
            ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col transition-all duration-300"
            : `absolute top-16 z-[200] w-[340px] max-h-[calc(100vh-6rem)]
                      rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
                      shadow-xl text-white flex flex-col transition-all duration-300 ${
                        isRegulationPanelOpen ? 'right-[416px]' : 'right-4'
                      }`
          }
        >
          <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
            <div>
              <div className="text-[10px] uppercase tracking-wider opacity-70">Measures</div>
              <div className="text-lg font-semibold">Regulation Plan</div>
              <div className="text-xs opacity-80">
                {regulations.length} Regulation{regulations.length !== 1 ? 's' : ''}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimized(true)}
                className="px-3 py-1 rounded-lg border border-white/30 bg-white/20 hover:bg-white/30 text-sm transition-colors"
                title="Minimize panel"
                aria-label="Minimize panel"
              >
                –
              </button>
            </div>
          </div>

          <div className={embedded ? "p-4 space-y-4" : "overflow-y-auto no-scrollbar p-4 flex-1 space-y-4"}>
        {/* Regulations Table */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium text-sm opacity-90">
              Regulations ({regulations.length})
            </div>
          </div>
          
          {regulations.length === 0 ? (
            <div className="text-xs opacity-70 text-center py-4">
              No regulations created yet. Use the regulation panel to create one.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto no-scrollbar">
              <div className="space-y-2">
                {regulations.map((reg) => (
                  <div
                    key={reg.id}
                    onMouseEnter={() => {
                      if (hoveredRegulationIdRef.current !== reg.id) {
                        hoverPreviewBaselineRef.current = new Set(useSimStore.getState().flightLinePreviewFlightIds);
                      }
                      hoveredRegulationIdRef.current = reg.id;
                      setFlightLinePreviewFlightIds(new Set(normalizeFlightIdList(reg.flightIds)));
                    }}
                    onMouseLeave={restoreHoveredFlightLinePreview}
                    onClick={() => setSelectedRegulation(selectedRegulation === reg.id ? null : reg.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
                      selectedRegulation === reg.id
                        ? 'bg-white/15 border-white/30'
                        : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-mono text-sm font-semibold">{reg.id}</div>
                        <div className="text-xs opacity-80">{reg.trafficVolume}</div>
                        {reg.proposalSource?.kind === "proposal" && (
                          <div className="mt-1 text-[10px] text-cyan-200/90">
                            {reg.proposalSource.proposalId}
                            {reg.proposalSource.flowId ? ` · Flow ${reg.proposalSource.flowId}` : ""}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            restoreHoveredFlightLinePreview();
                            // Hand off to regulation panel for editing
                            setRegulationEditPayload({
                              trafficVolume: reg.trafficVolume,
                              activeTimeWindowFrom: reg.activeTimeWindowFrom,
                              activeTimeWindowTo: reg.activeTimeWindowTo,
                              flightIds: Array.isArray(reg.flightIds) ? reg.flightIds.slice() : [],
                              flightCallsigns: reg.flightCallsigns,
                              resourceDate: reg.resourceDate ?? null,
                              resourceStateId: reg.resourceStateId ?? null,
                              rate: reg.rate,
                            });
                            // Align sim time to the start of the active window
                            setT(reg.activeTimeWindowFrom);
                            // Open the panel and ask the map to select & highlight this traffic volume
                            setIsRegulationPanelOpen(true);
                            window.dispatchEvent(new CustomEvent('traffic-volume-search-select', { detail: { trafficVolumeId: reg.trafficVolume } }));
                            removeRegulation(reg.id);
                          }}
                          className="text-blue-300 hover:text-blue-200 p-1"
                          title="Edit regulation"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12.3 6.3l5.4 5.4M3 21l4.5-1.2L18.7 8.6a1.5 1.5 0 0 0 0-2.1L17.5 5.3a1.5 1.5 0 0 0-2.1 0L5.4 15.8 3 21z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            restoreHoveredFlightLinePreview();
                            removeRegulation(reg.id);
                          }}
                          className="text-red-300 hover:text-red-200 p-1"
                          title="Delete regulation"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M6 7h12M9 7v10m6-10v10M4 7h16l-1 14H5L4 7zm5-3h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.5"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="opacity-70">Rate:</span> {reg.rate}/h
                      </div>
                      <div>
                        <span className="opacity-70">Flights:</span> {getRegulationTargetCount(reg)}
                      </div>
                      <div className="col-span-2">
                        <span className="opacity-70">Time:</span> {formatTime(reg.activeTimeWindowFrom)}-{formatTime(reg.activeTimeWindowTo)}
                      </div>
                    </div>
                    
                    {selectedRegulation === reg.id && (
                      <div className="mt-3 pt-3 border-t border-white/20">
                        <div className="text-xs">
                          <div className="opacity-70 mb-2">Flight List:</div>
                          <div className="max-h-20 overflow-y-auto bg-white/5 rounded p-2">
                            {resolveRegulationTargetLabels(reg, flights).map((label, idx) => (
                              <div key={idx} className="font-mono text-[10px]">{label}</div>
                            ))}
                          </div>
                          {reg.proposalSource?.kind === "proposal" && (
                            <div className="mt-2 text-[10px] text-cyan-200/90">
                              Derived from {reg.proposalSource.proposalId}
                              {reg.proposalSource.flowId ? ` / Flow ${reg.proposalSource.flowId}` : ""}
                            </div>
                          )}
                          {!sameRegulationContext(getRegulationContext(reg), currentContext) && (
                            <div className="mt-2 text-[10px] text-amber-200">
                              Created under a different resource state. Switch back before editing or simulating.
                            </div>
                          )}
                          {normalizeFlightIdList(reg.flightIds).length === 0 && (
                            <div className="mt-2 text-[10px] text-red-200">
                              Legacy target format detected. Recreate this regulation before simulating it.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Save / Load Plans */}
        <div className="flex items-center justify-between">
          <div className="text-sm opacity-80">
            Saved plans
            <span className="ml-2 text-[11px] opacity-60">({savedPlans.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLoadModalOpen(true)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-white/20 bg-white/10 text-white text-xs shadow hover:bg-white/15"
              title="Load a saved regulation plan"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Load plan
            </button>
            <button
              onClick={() => setSaveModalOpen(true)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-indigo-300/40 bg-indigo-500/30 text-white text-xs shadow hover:bg-indigo-500/40"
              title="Save the current regulation plan"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              Save plan
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-2">
          {isSimulating ? (
            <div className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-medium shadow flex items-center gap-2 text-sm">
              <ShimmeringText text="Imagining..." className="text-sm" />
            </div>
          ) : (
            <>
                <button
                onClick={async () => {
                  setErrorMessage(null);
                  if (!regulations || regulations.length === 0) {
                    setErrorMessage("No regulations available to simulate.");
                    return;
                  }
                  setIsSimulating(true);
                  try {
                    const result = await simulateRegulationPlan({
                      regulations,
                      perAccAttribMode: "dwelling_spread",
                      currentContext,
                    });
                    setRegulationSimulationResult(result);
                    setIsResultsOpen(true);
                  } catch (err) {
                    console.error(err);
                    setErrorMessage(err instanceof Error ? err.message : "Unknown error during simulation");
                  } finally {
                    setIsSimulating(false);
                  }
                }}
                disabled={isSimulating || regulations.length === 0}
                className={`px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-medium shadow flex items-center gap-2 text-sm ${
                  regulations.length === 0 ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
                }`}
                title={regulations.length === 0 ? "No regulations to simulate" : "Simulate plan"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 5v14l11-7z" fill="currentColor"/>
                </svg>
                Simulate Plan
              </button>

              
            </>
          )}
        </div>

            {errorMessage && (
              <div className="text-red-200 text-xs text-center mt-2 opacity-90">{errorMessage}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function formatDateTime(ts: number): string {
  if (!Number.isFinite(ts)) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function loadSavedPlansFromStorage(): SavedRegulationPlan[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(REGULATION_PLAN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .map((plan: any): SavedRegulationPlan | null => {
        if (!plan || typeof plan !== "object") return null;
        const id = typeof plan.id === "string" ? plan.id : `plan-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const label = typeof plan.label === "string" && plan.label.trim() ? plan.label : "Untitled plan";
        const savedAt = typeof plan.savedAt === "number" ? plan.savedAt : Date.now();
        const data = plan.data && typeof plan.data === "object" ? plan.data : {};
        const regulationsRaw = Array.isArray(data.regulations) ? data.regulations : [];
        const regulations = regulationsRaw.map((reg: any) => ({
          ...reg,
          flightIds: normalizeFlightIdList(reg?.flightIds),
          flightCallsigns: Array.isArray(reg?.flightCallsigns) ? reg.flightCallsigns.slice() : [],
          ...normalizeRegulationContext({
            resourceDate: reg?.resourceDate,
            resourceStateId: reg?.resourceStateId,
          }),
        }));
        return {
          id,
          label,
          savedAt,
          data: {
            regulations: regulations as RegulationsState,
          },
        };
      })
      .filter((plan): plan is SavedRegulationPlan => !!plan);
    return normalized.sort((a, b) => b.savedAt - a.savedAt);
  } catch (err) {
    console.warn("Failed to load saved regulation plans", err);
    return [];
  }
}

function persistSavedRegulationPlans(plans: SavedRegulationPlan[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(REGULATION_PLAN_STORAGE_KEY, JSON.stringify(plans));
    return true;
  } catch (err) {
    console.warn("Failed to persist saved regulation plans", err);
    return false;
  }
}

function deepCopy<T>(value: T): T {
  try {
    const maybeClone = (globalThis as any).structuredClone;
    if (typeof maybeClone === "function") {
      return maybeClone(value);
    }
  } catch {
    // ignore and fall back
  }
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
