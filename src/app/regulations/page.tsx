'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSimStore } from '@/components/useSimStore';
import RegulationCanvas from "@/components/RegulationCanvas";
import LeftControl1Regulation from "@/components/LeftControl1Regulation";
import RegulationFlightListLeftPanel2 from "@/components/RegulationFlightListLeftPanel2";
import RegulationPanel from "@/components/RegulationPanel";
import Header from "@/components/Header";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import ViewOptionsControl from "@/components/ViewOptionsControl";
import SlackViewControl from "@/components/SlackViewControl";

const LEFT_PANEL_WIDTH = 360;
const RIGHT_PANEL_WIDTH = 384;

export default function RegulationsPage() {
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
      <RegulationCanvas />
      <button
        type="button"
        aria-label={leftPanelsMinimized ? "Expand left panels" : "Collapse left panels"}
        title={leftPanelsMinimized ? "Expand left panels" : "Collapse left panels"}
        onClick={() => setLeftPanelsMinimized((prev) => !prev)}
        style={{ left: leftPanelsMinimized ? "0.75rem" : `calc(${LEFT_PANEL_WIDTH}px + 1.5rem)` }}
        className="absolute top-1/2 -translate-y-1/2 z-50 w-9 h-9 rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/20 transition-all duration-300 ease-in-out shadow-lg flex items-center justify-center"
      >
        <span className="text-lg font-semibold leading-none">
          {leftPanelsMinimized ? ">" : "<"}
        </span>
      </button>
      <button
        type="button"
        aria-label={rightPanelsMinimized ? "Expand right panels" : "Collapse right panels"}
        title={rightPanelsMinimized ? "Expand right panels" : "Collapse right panels"}
        onClick={() => setRightPanelsMinimized((prev) => !prev)}
        style={{ right: rightPanelsMinimized ? "0.75rem" : `calc(${RIGHT_PANEL_WIDTH}px + 1.5rem)` }}
        className="absolute top-1/2 -translate-y-1/2 z-50 w-9 h-9 rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/20 transition-all duration-300 ease-in-out shadow-lg flex items-center justify-center"
      >
        <span className="text-lg font-semibold leading-none">
          {rightPanelsMinimized ? "<" : ">"}
        </span>
      </button>
      {/* Left-side wrapper: full-height scroll; panels take natural height */}
      <div
        style={{ transform: leftPanelsMinimized ? "translateX(calc(-100% - 1.5rem))" : "translateX(0)" }}
        className={`absolute top-0 left-4 z-40 w-[360px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${leftPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto">
          <LeftControl1Regulation embedded />
        </div>
        <div className="pointer-events-auto">
          <RegulationFlightListLeftPanel2 embedded />
        </div>
      </div>
      {/* Right-side wrapper: full-height scroll for the panel */}
      <div
        style={{ transform: rightPanelsMinimized ? "translateX(calc(100% + 1.5rem))" : "translateX(0)" }}
        className={`absolute top-0 right-4 z-40 w-[384px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${rightPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto">
          <RegulationPanel embedded />
        </div>
      </div>
      <SlackViewControl />
      <ViewOptionsControl />
    </main>
  );
}
