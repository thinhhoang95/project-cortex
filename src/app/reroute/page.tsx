"use client";

import { useState } from "react";
import { useResourceDateGuard } from "@/components/useResourceDateGuard";
import Header from "@/components/Header";
import LeftControl1 from "@/components/LeftControl1";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import MapCanvasReroute from "@/components/MapCanvasReroute";
import ViewOptionsControl from "@/components/ViewOptionsControl";
import SidePanelToggleButton from "@/components/SidePanelToggleButton";
import RerouteBaseFlightListPanel from "@/components/RerouteBaseFlightListPanel";
import RerouteGeometrySync from "@/components/RerouteGeometrySync";
import RerouteIntelligentFlightSelectorPanel from "@/components/RerouteIntelligentFlightSelectorPanel";
import RerouteProposalsPanel from "@/components/RerouteProposalsPanel";
import RerouteTvSelectionInfoPanel from "@/components/RerouteTvSelectionInfoPanel";
import RerouteTvBaseListSync from "@/components/RerouteTvBaseListSync";

export default function ReroutePage() {
  const [leftPanelsMinimized, setLeftPanelsMinimized] = useState(false);
  const [rightPanelsMinimized, setRightPanelsMinimized] = useState(false);
  const { hydrated, ready, resourceDate, user } = useResourceDateGuard();

  if (!hydrated || !ready || !user) {
    return null;
  }

  return (
    <main key={resourceDate ?? "no-resource-date"} className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <StateResetOnPageLoad />
      <Header />
      <RerouteTvBaseListSync />
      <RerouteGeometrySync />
      <MapCanvasReroute />

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

      <div
        style={{ transform: leftPanelsMinimized ? "translateX(calc(-100% - 1.5rem))" : "none" }}
        className={`absolute top-0 left-4 z-40 w-[420px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${leftPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto w-full max-w-[384px] mx-auto">
          <LeftControl1 embedded />
        </div>
        <div className="pointer-events-auto">
          <RerouteBaseFlightListPanel embedded />
        </div>
      </div>

      <div
        style={{ transform: rightPanelsMinimized ? "translateX(calc(100% + 1.5rem))" : "none" }}
        className={`absolute top-0 right-4 z-40 w-[384px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${rightPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto">
          <RerouteProposalsPanel embedded />
        </div>
        <div className="pointer-events-auto">
          <RerouteIntelligentFlightSelectorPanel embedded />
        </div>
        <div className="pointer-events-auto">
          <RerouteTvSelectionInfoPanel embedded />
        </div>
      </div>

      <ViewOptionsControl showAirspaceDisplayToggle />
    </main>
  );
}
