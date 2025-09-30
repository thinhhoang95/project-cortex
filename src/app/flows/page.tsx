'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSimStore } from '@/components/useSimStore';
import FlowCanvas from "@/components/FlowCanvas";
import LeftControl1Flow from "@/components/LeftControl1Flow";
import FlowRegulationPanel from "@/components/FlowRegulationPanel";
import RegulationProposalPanel from "@/components/RegulationProposalPanel";
import FlowAirspaceView from "@/components/FlowAirspaceView";
import FlowPlanPanel from "@/components/FlowPlanPanel";
import Header from "@/components/Header";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import ViewOptionsControl from "@/components/ViewOptionsControl";
import SidePanelToggleButton from "@/components/SidePanelToggleButton";

export default function FlowsPage() {
  const router = useRouter();
  const user = useSimStore((state) => state.user);
  const isRegulationProposalPanelOpen = useSimStore((state) => state.isRegulationProposalPanelOpen);
  const proposalLoading = useSimStore((state) => state.proposalLoading);
  const [hydrated, setHydrated] = useState(false);
  const [leftPanelsMinimized, setLeftPanelsMinimized] = useState(false);
  const [rightPanelsMinimized, setRightPanelsMinimized] = useState(false);

  useEffect(() => {
    const unsub = useSimStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useSimStore.persist.hasHydrated());
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (hydrated && !user) {
      router.push('/login');
    }
  }, [hydrated, user, router]);

  if (!hydrated || !user) {
    return null;
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <StateResetOnPageLoad />
      <Header />
      <FlowCanvas />
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
        style={{ transform: leftPanelsMinimized ? "translateX(calc(-100% - 1.5rem))" : "translateX(0)" }}
        className={`absolute top-0 left-4 z-40 w-[360px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${leftPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto">
          <LeftControl1Flow embedded />
        </div>
      </div>
      {/* Right-side wrapper group */}
      <div
        style={{ transform: rightPanelsMinimized ? "translateX(calc(100% + 1.5rem))" : "translateX(0)" }}
        className={`absolute top-0 right-4 z-40 h-screen min-h-0 pointer-events-none flex gap-4 transition-all duration-300 ease-in-out ${rightPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="w-[340px] h-full min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none">
          <div className="pointer-events-auto">
            <FlowPlanPanel embedded />
          </div>
        </div>
        <div className="w-[384px] h-full min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none">
          <div className="pointer-events-auto">
            <FlowRegulationPanel embedded />
          </div>
          {(isRegulationProposalPanelOpen || proposalLoading) && (
            <div className="pointer-events-auto">
              <RegulationProposalPanel embedded />
            </div>
          )}
          <div className="pointer-events-auto">
            <FlowAirspaceView embedded />
          </div>
        </div>
      </div>
      <ViewOptionsControl />
    </main>
  );
}
