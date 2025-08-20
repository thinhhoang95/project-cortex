"use client";
import { create } from "zustand";
import { Trajectory } from "@/lib/models";

type State = {
  t: number;               // current sim time (s)
  range: [number, number]; // global window
  speed: number;
  playing: boolean;
  showFlightLineLabels: boolean;
  showCallsigns: boolean;
  showFlightLines: boolean;
  selectedTrafficVolume: string | null;
  flLowerBound: number;
  flUpperBound: number;
  flights: Trajectory[];
  focusMode: boolean;
  focusFlightIds: Set<string>;
  setRange: (r: [number, number], t?: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (v: number) => void;
  setShowFlightLineLabels: (show: boolean) => void;
  setShowCallsigns: (show: boolean) => void;
  setShowFlightLines: (show: boolean) => void;
  setSelectedTrafficVolume: (tv: string | null) => void;
  setFlLowerBound: (fl: number) => void;
  setFlUpperBound: (fl: number) => void;
  setFlRange: (lower: number, upper: number) => void;
  setFlights: (flights: Trajectory[]) => void;
  setFocusMode: (enabled: boolean) => void;
  setFocusFlightIds: (flightIds: Set<string>) => void;
  setT: (t: number) => void;
  tick: (dtMs: number) => void;
};

export const useSimStore = create<State>((set, get) => ({
  t: 0,
  range: [0, 24*3600],
  playing: false,
  speed: 1,
  showFlightLineLabels: true,
  showCallsigns: true,
  showFlightLines: true,
  selectedTrafficVolume: null,
  flLowerBound: 0,
  flUpperBound: 500,
  flights: [],
  focusMode: false,
  focusFlightIds: new Set<string>(),
  setRange: (r, t = get().t) => set({ range: r, t }),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (v) => set({ speed: v }),
  setShowFlightLineLabels: (show) => set({ showFlightLineLabels: show }),
  setShowCallsigns: (show) => set({ showCallsigns: show }),
  setShowFlightLines: (show) => set({ showFlightLines: show }),
  setSelectedTrafficVolume: (tv) => set({ selectedTrafficVolume: tv }),
  setFlLowerBound: (fl) => set({ flLowerBound: fl }),
  setFlUpperBound: (fl) => set({ flUpperBound: fl }),
  setFlRange: (lower, upper) => set({ flLowerBound: lower, flUpperBound: upper }),
  setFlights: (flights) => set({ flights }),
  setFocusMode: (enabled) => set({ focusMode: enabled }),
  setFocusFlightIds: (flightIds) => set({ focusFlightIds: flightIds }),
  setT: (t) => set({ t }),
  tick: (dtMs) => {
    const { playing, speed, t, range } = get();
    if (!playing) return;
    const dt = (dtMs/1000) * speed;
    const next = t + dt;
    set({ t: next > range[1] ? range[0] : next });
  }
}));