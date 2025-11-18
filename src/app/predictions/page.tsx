'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSimStore } from "@/components/useSimStore";
import PredictionsMapCanvas from "@/components/PredictionsMapCanvas";
import LeftControl1 from "@/components/LeftControl1";
import PredictionSettingsPanel from "@/components/PredictionSettingsPanel";
import RightControl1 from "@/components/RightControl1";
import Header from "@/components/Header";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import ViewOptionsControl from "@/components/ViewOptionsControl";
import SidePanelToggleButton from "@/components/SidePanelToggleButton";
import ReleaseNotesDialog from "@/components/ReleaseNotesDialog";
import AlternativeRoutesPanel from "@/components/AlternativeRoutesPanel";

export default function Page() {
  const router = useRouter();
  const user = useSimStore((state) => state.user);
  const [hydrated, setHydrated] = useState(false);
  const [leftPanelsMinimized, setLeftPanelsMinimized] = useState(false);
  const [rightPanelsMinimized, setRightPanelsMinimized] = useState(false);
  const selectedFlightForAnalysis = useSimStore((state) => state.selectedFlightForAnalysis);
  const isAlternativeRoutesPanelOpen = useSimStore((state) => state.isAlternativeRoutesPanelOpen);

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
      <PredictionsMapCanvas />
      
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
      {/* Left-side wrapper: full-height, scrolls; panel inside does not */}
      <div
        style={{ transform: leftPanelsMinimized ? "translateX(calc(-100% - 1.5rem))" : "translateX(0)" }}
        className={`absolute top-0 left-4 z-40 w-[360px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 transition-all duration-300 ease-in-out ${leftPanelsMinimized ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      >
        <LeftControl1 embedded />
        <PredictionSettingsPanel embedded />
      </div>
      {/* Right-side wrapper: full-height scroll for the panel */}
      <div
        style={{ transform: rightPanelsMinimized ? "translateX(calc(100% + 1.5rem))" : "translateX(0)" }}
        className={`absolute top-0 right-4 z-40 w-[384px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${rightPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto">
          {isAlternativeRoutesPanelOpen && selectedFlightForAnalysis ? (
            <AlternativeRoutesPanel embedded />
          ) : (
            <RightControl1 embedded />
          )}
        </div>
      </div>
      <ViewOptionsControl />
      <ReleaseNotesDialog />
    </main>
  );
}
