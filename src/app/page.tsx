'use client';

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSimStore } from "@/components/useSimStore";
import MapCanvas from "@/components/MapCanvas";
import LeftControl1 from "@/components/LeftControl1";
import NetworkStatusPanel from "@/components/NetworkStatusPanel";
import RightControl1 from "@/components/RightControl1";
import Header from "@/components/Header";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import ViewOptionsControl from "@/components/ViewOptionsControl";

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
const LEFT_PANEL_WIDTH = 360;
const RIGHT_PANEL_WIDTH = 384;

export default function Page() {
  const router = useRouter();
  const user = useSimStore((state) => state.user);
  const flights = useSimStore((state) => state.flights);
  const t = useSimStore((state) => state.t);
  const [hydrated, setHydrated] = useState(false);
  const [leftPanelsMinimized, setLeftPanelsMinimized] = useState(false);
  const [rightPanelsMinimized, setRightPanelsMinimized] = useState(false);

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

  useEffect(() => {
    const unsub = useSimStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useSimStore.persist.hasHydrated());
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (hydrated && !user) {
      router.push('/login');
    }
  }, [hydrated, user, router]);

  if (!hydrated || !user) {
    return null;
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <StateResetOnPageLoad />
      <Header />
      <MapCanvas />
      <button
        type="button"
        aria-label={leftPanelsMinimized ? "Expand left panels" : "Collapse left panels"}
        title={leftPanelsMinimized ? "Expand left panels" : "Collapse left panels"}
        onClick={() => setLeftPanelsMinimized((prev) => !prev)}
        style={{ left: leftPanelsMinimized ? "0.75rem" : `calc(${LEFT_PANEL_WIDTH}px + 1.5rem)` }}
        className="absolute top-1/2 -translate-y-1/2 z-50 w-9 h-9 rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/20 transition-all duration-300 ease-in-out shadow-lg flex items-center justify-center"
      >
        <span className="text-lg font-semibold leading-none">
          {leftPanelsMinimized ? ">" : "<"}
        </span>
      </button>
      <button
        type="button"
        aria-label={rightPanelsMinimized ? "Expand right panels" : "Collapse right panels"}
        title={rightPanelsMinimized ? "Expand right panels" : "Collapse right panels"}
        onClick={() => setRightPanelsMinimized((prev) => !prev)}
        style={{ right: rightPanelsMinimized ? "0.75rem" : `calc(${RIGHT_PANEL_WIDTH}px + 1.5rem)` }}
        className="absolute top-1/2 -translate-y-1/2 z-50 w-9 h-9 rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/20 transition-all duration-300 ease-in-out shadow-lg flex items-center justify-center"
      >
        <span className="text-lg font-semibold leading-none">
          {rightPanelsMinimized ? "<" : ">"}
        </span>
      </button>
      {/* Left-side wrapper: full-height, scrolls; panel inside does not */}
      <div
        style={{ transform: leftPanelsMinimized ? "translateX(calc(-100% - 1.5rem))" : "translateX(0)" }}
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
        style={{ transform: rightPanelsMinimized ? "translateX(calc(100% + 1.5rem))" : "translateX(0)" }}
        className={`absolute top-0 right-4 z-40 w-[384px] h-screen min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${rightPanelsMinimized ? "opacity-0" : "opacity-100"}`}
      >
        <div className="pointer-events-auto">
          <RightControl1 embedded />
        </div>
      </div>
      <ViewOptionsControl />
    </main>
  );
}
