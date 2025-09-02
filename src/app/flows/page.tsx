import FlowCanvas from "@/components/FlowCanvas";
import LeftControl1Flow from "@/components/LeftControl1Flow";
import FlowRegulationPanel from "@/components/FlowRegulationPanel";
import FlowAirspaceView from "@/components/FlowAirspaceView";
import FlowPlanPanel from "@/components/FlowPlanPanel";
import Header from "@/components/Header";

export default function FlowsPage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <Header />
      <FlowCanvas />
      {/* Left-side wrapper: full-height scroll; panels take natural height */}
      <div className="absolute top-0 left-4 z-40 w-[360px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4">
        <LeftControl1Flow embedded />
      </div>
      {/* Right-side wrapper for Regulation + Flow panels (full-height, below header) */}
      <div className="right-side-wrapper absolute top-0 right-4 z-40 w-[384px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4">
        <FlowRegulationPanel embedded />
        <FlowAirspaceView embedded />
      </div>
      {/* Dock FlowPlanPanel to the left of the right-side wrapper */}
      <FlowPlanPanel />
    </main>
  );
}
