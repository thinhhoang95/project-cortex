'use client';

import { useMemo, useState } from "react";
import { useResourceDateGuard } from "@/components/useResourceDateGuard";
import { useSimStore } from "@/components/useSimStore";
import MapCanvas from "@/components/MapCanvas";
import LeftControl1 from "@/components/LeftControl1";
import NetworkStatusPanel from "@/components/NetworkStatusPanel";
import RightControl1 from "@/components/RightControl1";
import Header from "@/components/Header";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import ViewOptionsControl from "@/components/ViewOptionsControl";
import SidePanelToggleButton from "@/components/SidePanelToggleButton";
import ReleaseNotesDialog from "@/components/ReleaseNotesDialog";

function countTimesUpTo(sortedTimes: number[], value: number): number {
  let lo = 0;
  let hi = sortedTimes.length;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sortedTimes[mid] <= value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo;
}

const DAY_SECONDS = 24 * 60 * 60;
export default function Page() {
  const flights = useSimStore((state) => state.flights);
  const t = useSimStore((state) => state.t);
  const [leftPanelsMinimized, setLeftPanelsMinimized] = useState(false);
  const [rightPanelsMinimized, setRightPanelsMinimized] = useState(false);
  const { hydrated, ready, resourceDate, user } = useResourceDateGuard();

  const sortedStartTimes = useMemo(() => {
    if (!flights || flights.length === 0) {
      return [] as number[];
    }

    return flights
      .map((flight) => flight.t0)
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => a - b);
  }, [flights]);

  const sortedEndTimes = useMemo(() => {
    if (!flights || flights.length === 0) {
      return [] as number[];
    }

    return flights
      .map((flight) => {
        const start = flight.t0;
        const end = flight.t1;
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          return null;
        }

        // Flights crossing midnight report an end time earlier than start; shift
        // those landings into the next day so they don't look landed immediately.
        return end < start ? end + DAY_SECONDS : end;
      })
      .filter((time): time is number => typeof time === 'number' && Number.isFinite(time))
      .sort((a, b) => a - b);
  }, [flights]);

  const { total: flightsTotal, landed: flightsLanded, airborne: flightsAirborne } = useMemo(() => {
    const total = flights?.length ?? 0;
    if (total === 0) {
      return { total: 0, landed: 0, airborne: 0 };
    }

    const startedCount = Math.min(total, countTimesUpTo(sortedStartTimes, t));
    const landedCount = Math.min(total, countTimesUpTo(sortedEndTimes, t));
    const inFlight = startedCount - landedCount;
    const remaining = Math.max(0, total - landedCount);
    const airborneCount = Math.max(0, Math.min(inFlight, remaining));

    return {
      total,
      landed: landedCount,
      airborne: airborneCount,
    };
  }, [flights, sortedStartTimes, sortedEndTimes, t]);

  if (!hydrated || !ready || !user) {
    return null;
  }

  return (
    <main key={resourceDate ?? "no-resource-date"} className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <StateResetOnPageLoad />
      <Header />
      <MapCanvas />
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
      {/* Left-side wrapper: full-height, scrolls; panel inside does not */}
      <div
        style={{ transform: leftPanelsMinimized ? "translateX(calc(-100% - 1.5rem))" : "none" }}
        className={`absolute top-0 left-4 z-40 w-[360px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 transition-all duration-300 ease-in-out ${leftPanelsMinimized ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      >
        <LeftControl1 embedded />
        <NetworkStatusPanel
          embedded
          flightsTotal={flightsTotal}
          flightsLanded={flightsLanded}
          flightsAirborne={flightsAirborne}
        />
      </div>
      {/* Right-side wrapper: full-height scroll for the panel */}
      <div
        style={{ transform: rightPanelsMinimized ? "translateX(calc(100% + 1.5rem))" : "none" }}
        className={`absolute top-0 right-4 z-40 w-[384px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${rightPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto">
          <RightControl1 embedded />
        </div>
      </div>
      <ViewOptionsControl showAirspaceDisplayToggle />
      <ReleaseNotesDialog />
    </main>
  );
}
