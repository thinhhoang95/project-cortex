import FlowCanvas from "@/components/FlowCanvas";
import LeftControl1Flow from "@/components/LeftControl1Flow";
import FlowRegulationPanel from "@/components/FlowRegulationPanel";
import FlowAirspaceView from "@/components/FlowAirspaceView";
import Header from "@/components/Header";

export default function FlowsPage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <Header />
      <FlowCanvas />
      <div className="absolute top-20 left-4 z-50 w-[360px] h-[calc(100vh-6rem)] max-h-[calc(100vh-6rem)] min-h-0 flex flex-col gap-4 overflow-hidden">
        <LeftControl1Flow />
      </div>
      {/* Right-side wrapper for Regulation + Flow panels (full-height, below header) */}
      <div className="right-side-wrapper absolute top-0 right-4 z-40 w-[384px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4">
        <FlowRegulationPanel embedded />
        <FlowAirspaceView embedded />
      </div>
    </main>
  );
}


