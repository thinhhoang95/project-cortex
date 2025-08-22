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
      <div className="absolute top-20 left-4 z-50 w-[360px] h-[calc(100vh-6rem)] max-h-[calc(100vh-6rem)] min-h-0 flex flex-col gap-4 overflow-hidden">
        <LeftControl1Regulation />
        <RegulationFlightListLeftPanel2 />
      </div>
      <RegulationPanel />
    </main>
  );
}


