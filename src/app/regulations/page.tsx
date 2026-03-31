'use client';

import { useEffect, useRef, useState } from 'react';
import { useResourceDateGuard } from '@/components/useResourceDateGuard';
import { useSimStore } from '@/components/useSimStore';
import RegulationCanvas from "@/components/RegulationCanvas";
import LeftControl1Regulation from "@/components/LeftControl1Regulation";
import RegulationFlightListLeftPanel2 from "@/components/RegulationFlightListLeftPanel2";
import RegulationPanel from "@/components/RegulationPanel";
import RegulationPlanPanel from "@/components/RegulationPlanPanel";
import RegulationProposalPanel from "@/components/RegulationProposalPanel";
import BottomControlsGroup from "@/components/BottomControlsGroup";
import Header from "@/components/Header";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import SidePanelToggleButton from "@/components/SidePanelToggleButton";
import {
  loadRegSnapshots,
  estimateRegSnapshotsSize,
  REG_SNAPSHOT_SIZE_WARN_THRESHOLD,
  REG_SNAPSHOT_STORAGE_KEY,
} from '@/lib/reg-comparison';

export default function RegulationsPage() {
  const isRegulationPanelOpen = useSimStore((state) => state.isRegulationPanelOpen);
  const isRegulationProposalPanelOpen = useSimStore((state) => state.isRegulationProposalPanelOpen);
  const proposalLoading = useSimStore((state) => state.proposalLoading);
  const selectedTrafficVolume = useSimStore((state) => state.selectedTrafficVolume);
  const selectedTrafficVolumes = useSimStore((state) => state.selectedTrafficVolumes);
  const [leftPanelsMinimized, setLeftPanelsMinimized] = useState(false);
  const [rightPanelsMinimized, setRightPanelsMinimized] = useState(false);
  const [regComparisonToast, setRegComparisonToast] = useState<{
    message: string;
    action?: { label: string; href: string };
    kind?: 'info' | 'warning';
  } | null>(null);
  const { hydrated, ready, resourceDate, user } = useResourceDateGuard();
  const regulationRightPaneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRegulationProposalPanelOpen || proposalLoading) {
      regulationRightPaneRef.current?.scrollTo({ top: regulationRightPaneRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [isRegulationProposalPanelOpen, proposalLoading]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateToast = () => {
      const snapshots = loadRegSnapshots();
      if (!snapshots || snapshots.length === 0) {
        setRegComparisonToast(null);
        return;
      }
      const bytes = estimateRegSnapshotsSize(snapshots);
      const approxKb = Math.max(0, Math.round(bytes / 1024));
      const baseMessage =
        snapshots.length === 1
          ? '1 regulation snapshot ready for comparison.'
          : `${snapshots.length} regulation snapshots ready for comparison.`;
      const isWarning = bytes > REG_SNAPSHOT_SIZE_WARN_THRESHOLD;
      setRegComparisonToast({
        message: isWarning
          ? `${baseMessage} Storage is at ~${approxKb} KB; consider exporting or clearing soon.`
          : baseMessage,
        action: { label: 'Open Comparison', href: '/regulation-comparison' },
        kind: isWarning ? 'warning' : 'info',
      });
    };

    updateToast();
    const onStorage = (ev: StorageEvent) => {
      if (ev.key && ev.key !== REG_SNAPSHOT_STORAGE_KEY) return;
      updateToast();
    };
    const onCustom: EventListener = () => updateToast();

    window.addEventListener('storage', onStorage);
    window.addEventListener('reg-snapshot-changed', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('reg-snapshot-changed', onCustom);
    };
  }, []);

  useEffect(() => {
    if (!regComparisonToast) return;
    const id = window.setTimeout(() => setRegComparisonToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [regComparisonToast]);

  if (!hydrated || !ready || !user) {
    return null;
  }

  const hasSelectedTrafficVolume =
    (Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0) ||
    !!selectedTrafficVolume;
  const showRegulationPanel = Boolean(isRegulationPanelOpen && hasSelectedTrafficVolume);

  return (
    <main key={resourceDate ?? "no-resource-date"} className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <StateResetOnPageLoad />
      <Header />
      <RegulationCanvas />
      <SidePanelToggleButton
        side="left"
        minimized={leftPanelsMinimized}
        onToggle={() => setLeftPanelsMinimized((prev) => !prev)}
        panelGroupLabel="left panels"
      />
      <SidePanelToggleButton
        side="right"
        minimized={rightPanelsMinimized}
        onToggle={() => setRightPanelsMinimized((prev) => !prev)}
        panelGroupLabel="right panels"
      />
      {/* Left-side wrapper: full-height scroll; panels take natural height */}
      <div
        data-bottom-controls-blocker="left"
        style={{ transform: leftPanelsMinimized ? "translateX(calc(-100% - 1.5rem))" : "none" }}
        className={`absolute top-0 left-4 z-40 w-[360px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${leftPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto">
          <LeftControl1Regulation embedded />
        </div>
        <div className="pointer-events-auto">
          <RegulationFlightListLeftPanel2 embedded />
        </div>
      </div>
      {/* Right-side wrapper group */}
      <div
        data-bottom-controls-blocker="right"
        style={{ transform: rightPanelsMinimized ? "translateX(calc(100% + 1.5rem))" : "none" }}
        className={`absolute top-0 right-4 z-40 h-screen min-h-0 pointer-events-none flex gap-4 transition-all duration-300 ease-in-out ${rightPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="w-[340px] h-full min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none">
          <div className="pointer-events-auto">
            <RegulationPlanPanel embedded isRegulationPanelOpen={showRegulationPanel} />
          </div>
        </div>
        {showRegulationPanel && (
          <div ref={regulationRightPaneRef} className="w-[384px] h-full min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none">
            <div className="pointer-events-auto">
              <RegulationPanel embedded />
            </div>
            {(isRegulationProposalPanelOpen || proposalLoading) && (
              <div className="pointer-events-auto">
                <RegulationProposalPanel embedded mode="regulations" />
              </div>
            )}
          </div>
        )}
      </div>
      <BottomControlsGroup />
      {regComparisonToast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm flex items-start gap-3 ${
            regComparisonToast.kind === 'warning'
              ? 'bg-amber-500/15 border-amber-300/60 text-amber-100'
              : 'bg-emerald-500/15 border-emerald-300/60 text-emerald-100'
          }`}
        >
          <div className="flex-1 text-sm">
            <div>{regComparisonToast.message}</div>
            {regComparisonToast.action && (
              <a href={regComparisonToast.action.href} className="mt-1 inline-flex items-center gap-1 text-[12px] underline">
                {regComparisonToast.action.label}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"></path>
                  <path d="M12 5l7 7-7 7"></path>
                </svg>
              </a>
            )}
          </div>
          <button
            onClick={() => setRegComparisonToast(null)}
            className="text-[12px] text-white/70 hover:text-white"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}
    </main>
  );
}
