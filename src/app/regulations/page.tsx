import RegulationCanvas from "@/components/RegulationCanvas";
import LeftControl1Regulation from "@/components/LeftControl1Regulation";
import RegulationFlightListLeftPanel2 from "@/components/RegulationFlightListLeftPanel2";
import RegulationPanel from "@/components/RegulationPanel";
import Header from "@/components/Header";

export default function RegulationsPage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <Header />
      <RegulationCanvas />
      {/* Left-side wrapper: full-height scroll; panels take natural height */}
      <div className="absolute top-0 left-4 z-40 w-[360px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4">
        <LeftControl1Regulation embedded />
        <RegulationFlightListLeftPanel2 embedded />
      </div>
      {/* Right-side wrapper: full-height scroll for the panel */}
      <div className="absolute top-0 right-4 z-40 w-[384px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4">
        <RegulationPanel embedded />
      </div>
    </main>
  );
}
