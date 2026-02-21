"use client";
import AirspaceInfo from "@/components/AirspaceInfo";
import CSAirspaceInfo from "@/components/CSAirspaceInfo";
import PanelCloseButton from "@/components/PanelCloseButton";
import { useSimStore } from "@/components/useSimStore";

type RightControl1Props = { embedded?: boolean };

export default function RightControl1({ embedded = false }: RightControl1Props) {
  const {
    airspaceDisplayMode,
    selectedTrafficVolume,
    selectedCollapsedSector,
    setSelectedTrafficVolume,
    setSelectedCollapsedSector,
    setFocusMode,
    setFocusFlightIds,
  } = useSimStore();

  const handleClose = () => {
    setSelectedTrafficVolume(null);
    setSelectedCollapsedSector(null);
    // Turn off focus mode and show all trajectories
    setFocusMode(false);
    setFocusFlightIds(new Set());
    // Also clear any highlighting in the MapCanvas by dispatching a custom event
    window.dispatchEvent(new CustomEvent('clearTrafficVolumeHighlight'));
  };

  if (!selectedTrafficVolume && !selectedCollapsedSector) {
    return null;
  }

  return (
    <div className={embedded
      ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"
      : "absolute top-20 right-4 z-50 min-w-[320px] max-w-[400px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"}>
      <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
        <h2 className="font-semibold">Airspace Information</h2>
        <PanelCloseButton onClick={handleClose} title="Close panel" />
      </div>
      
      <div className="p-4 flex-1">
        {airspaceDisplayMode === "es" ? <CSAirspaceInfo /> : <AirspaceInfo />}
      </div>
    </div>
  );
}
