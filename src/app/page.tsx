import MapCanvas from "@/components/MapCanvas";
import LeftControl1 from "@/components/LeftControl1";
import RightControl1 from "@/components/RightControl1";
import Header from "@/components/Header";

export default function Page() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <Header />
      <MapCanvas />
      <LeftControl1 />
      <RightControl1 />
    </main>
  );
}