import FlowCanvas from "@/components/FlowCanvas";
import LeftControl1Flow from "@/components/LeftControl1Flow";
import RightControl1 from "@/components/RightControl1";
import Header from "@/components/Header";

export default function FlowsPage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <Header />
      <FlowCanvas />
      <div className="absolute top-20 left-4 z-50 w-[360px] h-[calc(100vh-6rem)] max-h-[calc(100vh-6rem)] min-h-0 flex flex-col gap-4 overflow-hidden">
        <LeftControl1Flow />
      </div>
      <RightControl1 />
    </main>
  );
}


