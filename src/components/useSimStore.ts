"use client";
import { create } from "zustand";
import { Trajectory, SectorFeatureProps } from "@/lib/models";

interface Hotspot {
  traffic_volume_id: string;
  time_bin: string;
  z_max: number;
  z_sum: number;
  hourly_occupancy: number;
  hourly_capacity: number;
  is_overloaded: boolean;
}

interface HotspotResponse {
  hotspots: Hotspot[];
  count: number;
  metadata: {
    threshold: number;
    time_bin_minutes: number;
    analysis_type: string;
  };
  error?: string;
}

// Utility function to parse time string (HH:MM) to seconds
function parseTimeToSeconds(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 3600 + minutes * 60;
}

// Utility function to check if simulation time t falls within a time bin
function isTimeInBin(t: number, timeBin: string): boolean {
  const [startTime, endTime] = timeBin.split('-');
  const startSeconds = parseTimeToSeconds(startTime);
  const endSeconds = parseTimeToSeconds(endTime);
  
  // Handle case where time bin crosses midnight (e.g., "23:00-01:00")
  if (endSeconds < startSeconds) {
    return t >= startSeconds || t <= endSeconds;
  }
  
  return t >= startSeconds && t < endSeconds;
}

interface Regulation {
  id: string;
  trafficVolume: string;
  activeTimeWindowFrom: number;
  activeTimeWindowTo: number;
  flightCallsigns: string[];
  rate: number;
  createdAt: number;
}

type State = {
  t: number;               // current sim time (s)
  range: [number, number]; // global window
  speed: number;
  playing: boolean;
  showFlightLineLabels: boolean;
  showCallsigns: boolean;
  showFlightLines: boolean;
  showWaypoints: boolean;
  selectedTrafficVolume: string | null;
  selectedTrafficVolumeData: { properties: SectorFeatureProps } | null;
  flLowerBound: number;
  flUpperBound: number;
  flights: Trajectory[];
  focusMode: boolean;
  focusFlightIds: Set<string>;
  showHotspots: boolean;
  hotspots: Hotspot[];
  hotspotsLoading: boolean;
  // Regulation Design state
  regulationTargetFlightIds: Set<string>;
  regulationTimeWindow: [number, number];
  regulationRate: number;
  regulations: Regulation[];
  isRegulationPanelOpen: boolean;
  setRange: (r: [number, number], t?: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (v: number) => void;
  setShowFlightLineLabels: (show: boolean) => void;
  setShowCallsigns: (show: boolean) => void;
  setShowFlightLines: (show: boolean) => void;
  setShowWaypoints: (show: boolean) => void;
  setSelectedTrafficVolume: (tv: string | null, tvData?: { properties: SectorFeatureProps } | null) => void;
  setFlLowerBound: (fl: number) => void;
  setFlUpperBound: (fl: number) => void;
  setFlRange: (lower: number, upper: number) => void;
  setFlights: (flights: Trajectory[]) => void;
  setFocusMode: (enabled: boolean) => void;
  setFocusFlightIds: (flightIds: Set<string>) => void;
  setT: (t: number) => void;
  tick: (dtMs: number) => void;
  setShowHotspots: (show: boolean) => void;
  setHotspots: (hotspots: Hotspot[]) => void;
  setHotspotsLoading: (loading: boolean) => void;
  fetchHotspots: (threshold?: number) => Promise<void>;
  getActiveHotspots: () => Hotspot[];
  // Regulation Design actions
  setRegulationTargetFlightIds: (ids: Set<string>) => void;
  addRegulationTargetFlight: (flightId: string) => void;
  removeRegulationTargetFlight: (flightId: string) => void;
  clearRegulationTargetFlights: () => void;
  setRegulationTimeWindow: (from: number, to: number) => void;
  setRegulationRate: (rate: number) => void;
  addRegulation: (regulation: Omit<Regulation, 'id' | 'createdAt'>) => void;
  removeRegulation: (id: string) => void;
  setIsRegulationPanelOpen: (open: boolean) => void;
};

export const useSimStore = create<State>((set, get) => ({
  t: 0,
  range: [0, 24*3600],
  playing: false,
  speed: 1,
  showFlightLineLabels: true,
  showCallsigns: true,
  showFlightLines: true,
  showWaypoints: true,
  selectedTrafficVolume: null,
  selectedTrafficVolumeData: null,
  flLowerBound: 0,
  flUpperBound: 500,
  flights: [],
  focusMode: false,
  focusFlightIds: new Set<string>(),
  showHotspots: false,
  hotspots: [],
  hotspotsLoading: false,
  regulationTargetFlightIds: new Set<string>(),
  regulationTimeWindow: [0, 0],
  regulationRate: 0,
  regulations: [],
  isRegulationPanelOpen: false,
  setRange: (r, t = get().t) => set({ range: r, t }),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (v) => set({ speed: v }),
  setShowFlightLineLabels: (show) => set({ showFlightLineLabels: show }),
  setShowCallsigns: (show) => set({ showCallsigns: show }),
  setShowFlightLines: (show) => set({ showFlightLines: show }),
  setShowWaypoints: (show) => set({ showWaypoints: show }),
  setSelectedTrafficVolume: (tv, tvData = null) => set({ selectedTrafficVolume: tv, selectedTrafficVolumeData: tvData }),
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
  },
  setShowHotspots: (show) => set({ showHotspots: show }),
  setHotspots: (hotspots) => set({ hotspots }),
  setHotspotsLoading: (loading) => set({ hotspotsLoading: loading }),
  fetchHotspots: async (threshold: number = 0.0) => {
    set({ hotspotsLoading: true });
    try {
      const response = await fetch(`/api/hotspot?threshold=${threshold}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch hotspots: ${response.statusText}`);
      }
      const data: HotspotResponse = await response.json();
      
      // Log warning if using fallback data
      if (data.error) {
        console.warn('Hotspot API warning:', data.error);
      }
      
      // Hotspots are already sorted by z_max in the API
      set({ hotspots: data.hotspots || [] });
    } catch (error) {
      console.error('Error fetching hotspots:', error);
      set({ hotspots: [] });
    } finally {
      set({ hotspotsLoading: false });
    }
  },
  getActiveHotspots: () => {
    const { t, hotspots, showHotspots } = get();
    if (!showHotspots) return [];
    return hotspots.filter(hotspot => isTimeInBin(t, hotspot.time_bin));
  },
  setRegulationTargetFlightIds: (ids) => set({ regulationTargetFlightIds: ids }),
  addRegulationTargetFlight: (flightId) => {
    const current = new Set(get().regulationTargetFlightIds);
    current.add(String(flightId));
    set({ regulationTargetFlightIds: current });
  },
  removeRegulationTargetFlight: (flightId) => {
    const current = new Set(get().regulationTargetFlightIds);
    current.delete(String(flightId));
    set({ regulationTargetFlightIds: current });
  },
  clearRegulationTargetFlights: () => set({ regulationTargetFlightIds: new Set<string>() }),
  setRegulationTimeWindow: (from, to) => set({ regulationTimeWindow: [from, to] }),
  setRegulationRate: (rate) => set({ regulationRate: rate }),
  addRegulation: (regulation) => {
    const newRegulation: Regulation = {
      ...regulation,
      id: `REG${Date.now()}`,
      createdAt: Date.now()
    };
    set(state => ({ regulations: [...state.regulations, newRegulation] }));
  },
  removeRegulation: (id) => {
    set(state => ({ regulations: state.regulations.filter(r => r.id !== id) }));
  },
  setIsRegulationPanelOpen: (open) => set({ isRegulationPanelOpen: open })
}));