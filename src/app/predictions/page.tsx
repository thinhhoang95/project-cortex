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

export default function Page() {
  const router = useRouter();
  const user = useSimStore((state) => state.user);
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
      <PredictionsMapCanvas />
      
      {/* Error Overlay */}
      <div className="absolute inset-0 z-20 backdrop-blur-md bg-black/40 flex items-center justify-center p-8">
        <div className="bg-red-900/40 backdrop-blur-xl border border-red-500/40 rounded-2xl shadow-2xl max-w-lg w-full p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Error Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full"></div>
              <div className="relative bg-red-500/10 border-2 border-red-500/50 rounded-full p-4">
                <svg className="w-12 h-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
          </div>
          
          {/* Error Message */}
          <div className="space-y-4">
            <p className="text-slate-200 text-center leading-relaxed">
              Flow's Kitchen fails to connect to the{' '}
              <span className="font-semibold text-white">Equinox Prediction API</span> at <a 
                href="https://equinox-api.intuelle.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 transition-colors text-sm font-mono break-all"
              >
                https://equinox-api.intuelle.com
              </a>
            </p>
            
          </div>
          
          {/* Status Link */}
          <div className="pt-2 border-t border-slate-700/50">
            <p className="text-slate-400 text-sm text-center mb-3">
              Check the service status:
            </p>
            <a
              href="https://status.intuelle.com"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 text-center shadow-lg shadow-red-500/20 hover:shadow-red-500/40"
            >
              Visit Status Page →
            </a>
          </div>
        </div>
      </div>
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
          <RightControl1 embedded />
        </div>
      </div>
      <ViewOptionsControl />
      <ReleaseNotesDialog />
    </main>
  );
}
