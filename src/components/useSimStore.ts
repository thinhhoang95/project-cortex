"use client";
import { create } from "zustand";

type State = {
  t: number;               // current sim time (s)
  range: [number, number]; // global window
  speed: number;
  playing: boolean;
  showFlightLineLabels: boolean;
  showCallsigns: boolean;
  setRange: (r: [number, number], t?: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (v: number) => void;
  setShowFlightLineLabels: (show: boolean) => void;
  setShowCallsigns: (show: boolean) => void;
  tick: (dtMs: number) => void;
};

export const useSimStore = create<State>((set, get) => ({
  t: 0,
  range: [0, 24*3600],
  playing: false,
  speed: 1,
  showFlightLineLabels: true,
  showCallsigns: true,
  setRange: (r, t = get().t) => set({ range: r, t }),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (v) => set({ speed: v }),
  setShowFlightLineLabels: (show) => set({ showFlightLineLabels: show }),
  setShowCallsigns: (show) => set({ showCallsigns: show }),
  tick: (dtMs) => {
    const { playing, speed, t, range } = get();
    if (!playing) return;
    const dt = (dtMs/1000) * speed;
    const next = t + dt;
    set({ t: next > range[1] ? range[0] : next });
  }
}));