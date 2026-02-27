'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSimStore } from "@/components/useSimStore";
import PredictionsMapCanvas from "@/components/PredictionsMapCanvas";
import LeftControl1 from "@/components/LeftControl1";
import PredictionSettingsPanel from "@/components/PredictionSettingsPanel";
import StochasticTrafficVolumePanel from "@/components/StochasticTrafficVolumePanel";
import Header from "@/components/Header";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import ViewOptionsControl from "@/components/ViewOptionsControl";
import SidePanelToggleButton from "@/components/SidePanelToggleButton";
import ReleaseNotesDialog from "@/components/ReleaseNotesDialog";
import AlternativeRoutesPanel from "@/components/AlternativeRoutesPanel";

function PredictionUnavailableOverlay() {
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="relative max-w-lg w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 shadow-2xl backdrop-blur-md">
        {/* Decorative glows */}
        <div className="pointer-events-none absolute -top-32 -left-32 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
        
        <div className="relative z-10 flex flex-col items-center p-8 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-8 w-8 text-cyan-200">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          
          <h3 className="mb-2 text-xl font-semibold text-white">Prediction API Unavailable</h3>
          
          <p className="mb-8 text-sm leading-relaxed text-white/60">
            Prediction API is currently unavailable due to Project Gemini's sunset.<br/>
            For more information, please contact ENAC's PoC at{' '}
            <a href="mailto:huijuan.yang@enac.fr" className="font-medium text-cyan-300 hover:text-cyan-200 hover:underline">
              huijuan.yang@enac.fr
            </a>
            .
          </p>
          
           <Link href="/" className="rounded-full bg-white/10 px-8 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20 ring-1 ring-white/10">
              Return to Dashboard
           </Link>
        </div>
      </div>
    </div>
  );
}

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
      <PredictionUnavailableOverlay />
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
        style={{ transform: leftPanelsMinimized ? "translateX(calc(-100% - 1.5rem))" : "none" }}
        className={`absolute top-0 left-4 z-40 w-[360px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 transition-all duration-300 ease-in-out ${leftPanelsMinimized ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      >
        <LeftControl1 embedded />
        <PredictionSettingsPanel embedded />
      </div>
      {/* Right-side wrapper: full-height scroll for the panel */}
      <div
        style={{ transform: rightPanelsMinimized ? "translateX(calc(100% + 1.5rem))" : "none" }}
        className={`absolute top-0 right-4 z-40 w-[384px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${rightPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto">
          {isAlternativeRoutesPanelOpen && selectedFlightForAnalysis ? (
            <AlternativeRoutesPanel embedded />
          ) : (
            <StochasticTrafficVolumePanel embedded />
          )}
        </div>
      </div>
      <ViewOptionsControl />
      <ReleaseNotesDialog />
    </main>
  );
}
