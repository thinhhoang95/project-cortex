import MapCanvas from "@/components/MapCanvas";
import LeftControl1 from "@/components/LeftControl1";
import RightControl1 from "@/components/RightControl1";
import Header from "@/components/Header";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import ViewOptionsControl from "@/components/ViewOptionsControl";

export default function Page() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <StateResetOnPageLoad />
      <Header />
      <MapCanvas />
      {/* Left-side wrapper: full-height, scrolls; panel inside does not */}
      <div className="absolute top-0 left-4 z-40 w-[360px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4">
        <LeftControl1 embedded />
      </div>
      <RightControl1 />
      <ViewOptionsControl />
    </main>
  );
}
