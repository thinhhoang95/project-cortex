"use client";
import AirspaceInfo from "@/components/AirspaceInfo";
import { useSimStore } from "@/components/useSimStore";

export default function RightControl1() {
  const { setSelectedTrafficVolume } = useSimStore();

  const handleClose = () => {
    setSelectedTrafficVolume(null);
  };

  return (
    <div className="absolute top-20 right-4 z-50 min-w-[320px] max-w-[400px] max-h-[calc(100vh-6rem)]
                    rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
                    shadow-xl text-slate-900 text-white flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
        <h2 className="font-semibold">Airspace Information</h2>
        <button
          onClick={handleClose}
          className="px-2 py-1 rounded-lg border border-white/30 bg-white/20 hover:bg-white/30 text-sm transition-colors"
          title="Close panel"
        >
          ✕
        </button>
      </div>
      
      <div className="overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20 p-4 flex-1">
        <AirspaceInfo />
      </div>
    </div>
  );
}