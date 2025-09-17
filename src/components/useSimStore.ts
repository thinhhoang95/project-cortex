"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Trajectory, SectorFeatureProps, RegulationPlanSimulationResponse } from "@/lib/models";

interface User {
  email: string;
  signInDate: string;
  token: string;
  renewToken: string;
  displayName?: string;
  organization?: string;
}

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
  date: string;            // operation date in DD/MM/YYYY
  // Weather overlay selection
  weatherOverlay: 'none' | 'surface-precip';
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
  // Flow view state
  flowViewEnabled: boolean;
  flowThreshold: number;
  flowResolution: number;
  flowCommunities: Record<string, number> | null; // flightId -> communityId
  flowGroups: Record<string, string[]> | null;    // communityId -> flightIds
  flowColorByCommunity: Record<string, string> | null; // communityId -> color
  flowLoading: boolean;
  flowError: string | null;
  // Flow preview (hover) state
  flowPreviewGroupId: string | null;
  flowPreviewFlightId: string | null;
  // Regulation Design state
  regulationTargetFlightIds: Set<string>;
  regulationVisibleFlightIds: string[];
  regulationListedFlightIds: string[]; // full list (not limited by UI expansion)
  regulationTimeWindow: [number, number];
  regulationRate: number;
  regulations: Regulation[];
  isRegulationPanelOpen: boolean;
  // Simulation results modal
  regulationSimulationResult: RegulationPlanSimulationResponse | null;
  isResultsOpen: boolean;
  // Regulation edit handoff
  regulationEditPayload: Omit<Regulation, 'id' | 'createdAt'> | null;
  // Slack view state
  slackMode: "off" | "minus" | "plus";
  slackSign: "minus" | "plus";
  isFetchingSlack: boolean;
  deltaMin: number;
  // View options control (global minimized state so other UI can react)
  viewOptionsMinimized: boolean;
  // User state
  user: User | null;
  setRegulationVisibleFlightIds: (ids: string[]) => void;
  setRegulationListedFlightIds: (ids: string[]) => void;
  setRange: (r: [number, number], t?: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (v: number) => void;
  setDate: (date: string) => void;
  setWeatherOverlay: (overlay: 'none' | 'surface-precip') => void;
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
  // Flow view actions
  setFlowViewEnabled: (enabled: boolean) => void;
  setFlowThreshold: (threshold: number) => void;
  setFlowResolution: (resolution: number) => void;
  setFlowCommunities: (communities: Record<string, number> | null, groups?: Record<string, string[]> | null, colorOverride?: Record<string, string> | null) => void;
  setFlowLoading: (loading: boolean) => void;
  setFlowError: (error: string | null) => void;
  setFlowPreviewGroupId: (groupId: string | null) => void;
  setFlowPreviewFlightId: (flightId: string | null) => void;
  setFlowColorByCommunity: (m: Record<string, string> | null) => void;
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
  setRegulationEditPayload: (p: Omit<Regulation, 'id' | 'createdAt'> | null) => void;
  setRegulationSimulationResult: (r: RegulationPlanSimulationResponse | null) => void;
  setIsResultsOpen: (open: boolean) => void;
  // Slack view actions
  setSlackMode: (mode: "off" | "minus" | "plus") => void;
  setSlackSign: (sign: "minus" | "plus") => void;
  setIsFetchingSlack: (fetching: boolean) => void;
  setDeltaMin: (delta: number) => void;
  setViewOptionsMinimized: (minimized: boolean) => void;
  // Reset all non-function state back to defaults
  resetAll: () => void;
  // Auth
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
  // Target Cells (Traffic Volume + Time Period)
  targetCells: Array<{ id: string; trafficVolume: string; from: string; to: string; createdAt: number }>;
  addTargetCell: (trafficVolume: string, from: string, to: string) => string; // returns id (existing or new)
  addTargetCells: (trafficVolumes: string[], from: string, to: string) => string[]; // returns ids
  removeTargetCell: (id: string) => void;
  // Flow Basket (for FlowPlanPanel)
  flowBasket: Array<{
    id: string;
    name: string;
    color: string;
    items: FlowBasketItem[];
    // Regulation period associated with this flow (from FlowRegulationPanel)
    periodFrom?: string; // HH:MM
    periodTo?: string;   // HH:MM
    createdAt: number;
  }>;
  addFlowBasket: (name: string, items?: Array<string | FlowBasketItem>) => string; // returns new flow id
  addFlowBasketWithPeriod: (name: string, items: Array<string | FlowBasketItem>, periodFrom: string, periodTo: string) => string; // returns new flow id
  createEmptyFlowBasket: (name?: string) => string; // returns new flow id
  removeFlowBasket: (id: string) => void;
  addFlightsToBasketFlow: (id: string, items: Array<string | FlowBasketItem>) => void;
  removeFlightFromBasketFlow: (id: string, key: string) => void;
  moveFlightBetweenBasketFlows: (fromId: string, toId: string, key: string) => void;
  setFlowBasketPeriod: (id: string, periodFrom: string, periodTo: string, opts?: { overwrite?: boolean }) => void;
  setUser: (user: User | null) => void;
};

export type FlowBasketItem = {
  key: string; // flightId or callsign token
  requestedBin?: number;
  earliestCrossing?: string | null; // HH:MM(:SS)
};

// Centralized default values for non-function state
const defaultState: Pick<State,
  | 't'
  | 'range'
  | 'playing'
  | 'speed'
  | 'date'
  | 'weatherOverlay'
  | 'showFlightLineLabels'
  | 'showCallsigns'
  | 'showFlightLines'
  | 'showWaypoints'
  | 'selectedTrafficVolume'
  | 'selectedTrafficVolumeData'
  | 'flLowerBound'
  | 'flUpperBound'
  | 'flights'
  | 'focusMode'
  | 'focusFlightIds'
  | 'showHotspots'
  | 'hotspots'
  | 'hotspotsLoading'
  | 'flowViewEnabled'
  | 'flowThreshold'
  | 'flowResolution'
  | 'flowCommunities'
  | 'flowGroups'
  | 'flowColorByCommunity'
  | 'flowLoading'
  | 'flowError'
  | 'flowPreviewGroupId'
  | 'flowPreviewFlightId'
  | 'regulationTargetFlightIds'
  | 'regulationVisibleFlightIds'
  | 'regulationListedFlightIds'
  | 'regulationTimeWindow'
  | 'regulationRate'
  | 'regulations'
  | 'isRegulationPanelOpen'
  | 'regulationEditPayload'
  | 'regulationSimulationResult'
  | 'isResultsOpen'
  | 'targetCells'
  | 'flowBasket'
  | 'slackMode'
  | 'slackSign'
  | 'isFetchingSlack'
  | 'deltaMin'
  | 'viewOptionsMinimized'
  | 'user'
> = {
  t: 0,
  range: [0, 24 * 3600],
  playing: false,
  speed: 1,
  date: '01/08/2023',
  weatherOverlay: 'none',
  showFlightLineLabels: false,
  showCallsigns: false,
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
  flowViewEnabled: false,
  flowThreshold: 0.8,
  flowResolution: 1.0,
  flowCommunities: null,
  flowGroups: null,
  flowColorByCommunity: null,
  flowLoading: false,
  flowError: null,
  flowPreviewGroupId: null,
  flowPreviewFlightId: null,
  regulationTargetFlightIds: new Set<string>(),
  regulationVisibleFlightIds: [],
  regulationListedFlightIds: [],
  regulationTimeWindow: [0, 0],
  regulationRate: 0,
  regulations: [],
  isRegulationPanelOpen: false,
  regulationEditPayload: null,
  regulationSimulationResult: null,
  isResultsOpen: false,
  targetCells: [],
  flowBasket: [],
  slackMode: "off",
  slackSign: "minus",
  isFetchingSlack: false,
  deltaMin: 0,
  viewOptionsMinimized: false,
  user: null,
};

export const useSimStore = create(persist<State, [], [], Pick<State, 'user'>>((set, get) => ({
  ...defaultState,
  setUser: (user) => set({ user }),
  login: async (email: string, password: string) => {
    try {
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: email, password }).toString(),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const message = String((data as any)?.error || 'Invalid email or password');
        return { ok: false as const, error: message };
      }
      const token = String((data as any)?.access_token || '');
      if (!token) {
        return { ok: false as const, error: 'Malformed response from server' };
      }
      const displayName = typeof (data as any)?.display_name === 'string' ? (data as any).display_name : undefined;
      const organization = typeof (data as any)?.organization === 'string' ? (data as any).organization : undefined;
      set({ user: { email, signInDate: new Date().toISOString(), token, renewToken: '', displayName, organization } });
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: 'Unable to sign in. Please try again.' };
    }
  },
  logout: () => {
    set({ user: null });
  },
  setRange: (r, t = get().t) => set({ range: r, t }),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (v) => set({ speed: v }),
  setDate: (date) => set({ date }),
  setWeatherOverlay: (overlay) => set({ weatherOverlay: overlay }),
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
  setFlowViewEnabled: (enabled) => set({ flowViewEnabled: enabled }),
  setFlowThreshold: (threshold) => set({ flowThreshold: threshold }),
  setFlowResolution: (resolution) => set({ flowResolution: resolution }),
  setFlowCommunities: (communities, groups = null, colorOverride = undefined) => set({
    flowCommunities: communities,
    flowGroups: groups,
    flowColorByCommunity: colorOverride !== undefined ? colorOverride : computeFlowColorByCommunity(communities, groups)
  }),
  setFlowLoading: (loading) => set({ flowLoading: loading }),
  setFlowError: (error) => set({ flowError: error }),
  setFlowPreviewGroupId: (groupId) => set({ flowPreviewGroupId: groupId }),
  setFlowPreviewFlightId: (flightId) => set({ flowPreviewFlightId: flightId }),
  setFlowColorByCommunity: (m) => set({ flowColorByCommunity: m }),
  setRegulationVisibleFlightIds: (ids) => set({ regulationVisibleFlightIds: ids }),
  setRegulationListedFlightIds: (ids) => set({ regulationListedFlightIds: ids }),
  fetchHotspots: async (threshold: number = 0.0) => {
    set({ hotspotsLoading: true });
    try {
      const { authFetch } = await import("@/lib/auth");
      const response = await authFetch(`/api/hotspot?threshold=${threshold}`);
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
  setIsRegulationPanelOpen: (open) => set({ isRegulationPanelOpen: open }),
  setRegulationEditPayload: (p) => set({ regulationEditPayload: p }),
  setRegulationSimulationResult: (r) => set({ regulationSimulationResult: r }),
  setIsResultsOpen: (open) => set({ isResultsOpen: open }),
  // Slack view actions
  setSlackMode: (mode) => set({ slackMode: mode }),
  setSlackSign: (sign) => set({ slackSign: sign }),
  setIsFetchingSlack: (fetching) => set({ isFetchingSlack: fetching }),
  setDeltaMin: (delta) => set({ deltaMin: delta }),
  setViewOptionsMinimized: (minimized) => set({ viewOptionsMinimized: minimized }),
  // Reset all stateful values back to defaults (used on page navigation)
  resetAll: () => set((state) => ({ ...defaultState, user: state.user }))
  ,
  // Target Cells actions
  addTargetCell: (trafficVolume: string, from: string, to: string) => {
    const tv = String(trafficVolume).trim();
    const f = String(from).trim();
    const t = String(to).trim();
    if (!tv || !f || !t) return '';
    const existing = get().targetCells.find(c => c.trafficVolume === tv && c.from === f && c.to === t);
    if (existing) return existing.id;
    const id = `TC${Date.now()}${Math.floor(Math.random()*1000)}`;
    const createdAt = Date.now();
    set(state => ({ targetCells: [...state.targetCells, { id, trafficVolume: tv, from: f, to: t, createdAt }] }));
    return id;
  },
  addTargetCells: (trafficVolumes: string[], from: string, to: string) => {
    const ids: string[] = [];
    const tvs = Array.from(new Set((trafficVolumes || []).map(v => String(v).trim()).filter(Boolean)));
    const acc = get().targetCells.slice();
    for (const tv of tvs) {
      const f = String(from).trim();
      const t = String(to).trim();
      if (!tv || !f || !t) continue;
      const existing = acc.find(c => c.trafficVolume === tv && c.from === f && c.to === t);
      if (existing) { ids.push(existing.id); continue; }
      const id = `TC${Date.now()}${Math.floor(Math.random()*1000)}`;
      acc.push({ id, trafficVolume: tv, from: f, to: t, createdAt: Date.now() });
      ids.push(id);
    }
    set({ targetCells: acc });
    return ids;
  },
  removeTargetCell: (id: string) => set(state => ({ targetCells: state.targetCells.filter(c => c.id !== id) })),
  
  // Flow Basket actions
  addFlowBasket: (name: string, items: Array<string | FlowBasketItem> = []) => {
    const palette = [
      '#e6194b','#3cb44b','#ffe119','#0082c8','#f58231','#911eb4','#46f0f0','#f032e6','#d2f53c','#fabebe',
      '#008080','#e6beff','#aa6e28','#800000','#aaffc3','#808000','#ffd8b1','#000080','#bcf60c','#808080'
    ];
    const id = `FB${Date.now()}${Math.floor(Math.random()*1000)}`;
    const createdAt = Date.now();
    const colorIdx = get().flowBasket.length % palette.length;
    const color = palette[colorIdx];
    const normalized: FlowBasketItem[] = normalizeBasketItems(items);
    set(state => ({ flowBasket: [...state.flowBasket, { id, name: name || `Flow ${state.flowBasket.length+1}`, color, items: normalized, createdAt }] }));
    return id;
  },
  addFlowBasketWithPeriod: (name: string, items: Array<string | FlowBasketItem> = [], periodFrom: string, periodTo: string) => {
    const palette = [
      '#e6194b','#3cb44b','#ffe119','#0082c8','#f58231','#911eb4','#46f0f0','#f032e6','#d2f53c','#fabebe',
      '#008080','#e6beff','#aa6e28','#800000','#aaffc3','#808000','#ffd8b1','#000080','#bcf60c','#808080'
    ];
    const id = `FB${Date.now()}${Math.floor(Math.random()*1000)}`;
    const createdAt = Date.now();
    const colorIdx = get().flowBasket.length % palette.length;
    const color = palette[colorIdx];
    const normalized: FlowBasketItem[] = normalizeBasketItems(items);
    set(state => ({ flowBasket: [...state.flowBasket, { id, name: name || `Flow ${state.flowBasket.length+1}`, color, items: normalized, periodFrom, periodTo, createdAt }] }));
    return id;
  },
  createEmptyFlowBasket: (name?: string) => {
    return get().addFlowBasket(name || `Flow ${get().flowBasket.length+1}`, []);
  },
  removeFlowBasket: (id: string) => set(state => ({ flowBasket: state.flowBasket.filter(f => f.id !== id) })),
  addFlightsToBasketFlow: (id: string, items: Array<string | FlowBasketItem>) => {
    if (!items || items.length === 0) return;
    const normalized = normalizeBasketItems(items);
    set(state => ({
      flowBasket: state.flowBasket.map(f => {
        if (f.id !== id) return f;
        const byKey = new Map<string, FlowBasketItem>();
        for (const it of f.items) byKey.set(String(it.key), it);
        for (const it of normalized) byKey.set(String(it.key), { ...(byKey.get(String(it.key)) || { key: String(it.key) }), ...it });
        return { ...f, items: Array.from(byKey.values()) };
      })
    }));
  },
  setFlowBasketPeriod: (id: string, periodFrom: string, periodTo: string, opts?: { overwrite?: boolean }) => {
    set(state => ({
      flowBasket: state.flowBasket.map(f => {
        if (f.id !== id) return f;
        const shouldOverwrite = opts?.overwrite ?? false;
        if (!shouldOverwrite && f.periodFrom && f.periodTo) return f;
        return { ...f, periodFrom, periodTo };
      })
    }));
  },
  removeFlightFromBasketFlow: (id: string, key: string) => set(state => ({
    flowBasket: state.flowBasket.map(f => f.id === id ? { ...f, items: f.items.filter(it => String(it.key) !== String(key)) } : f)
  })),
  moveFlightBetweenBasketFlows: (fromId: string, toId: string, key: string) => {
    set(state => ({
      flowBasket: state.flowBasket.map(f => {
        if (f.id === fromId) return { ...f, items: f.items.filter(it => String(it.key) !== String(key)) };
        if (f.id === toId) {
          const byKey = new Map<string, FlowBasketItem>();
          for (const it of f.items) byKey.set(String(it.key), it);
          const existing = byKey.get(String(key));
          byKey.set(String(key), existing || { key: String(key) });
          return { ...f, items: Array.from(byKey.values()) };
        }
        return f;
      })
    }));
  }
}),
{
  name: 'sim-storage',
  partialize: (state) => ({ user: state.user }),
}
));

function normalizeBasketItems(items: Array<string | FlowBasketItem> | undefined): FlowBasketItem[] {
  const byKey = new Map<string, FlowBasketItem>();
  for (const it of items || []) {
    if (typeof it === 'string') {
      const key = String(it);
      byKey.set(key, { key });
    } else if (it && typeof it === 'object' && 'key' in it) {
      const key = String((it as any).key);
      const prev = byKey.get(key) || { key };
      byKey.set(key, { ...prev, ...it, key });
    }
  }
  return Array.from(byKey.values());
}

// Compute a deterministic community -> color mapping so UI and map use identical colors
function computeFlowColorByCommunity(
  communities: Record<string, number> | null,
  groups: Record<string, string[]> | null = null
): Record<string, string> | null {
  if (!communities && (!groups || Object.keys(groups).length === 0)) return null;

  const sizeByCommunity = new Map<string, number>();
  if (groups && Object.keys(groups).length > 0) {
    for (const [cid, ids] of Object.entries(groups)) {
      sizeByCommunity.set(String(cid), Array.isArray(ids) ? ids.length : 0);
    }
  } else if (communities) {
    for (const cidAny of Object.values(communities)) {
      const cid = String(cidAny);
      sizeByCommunity.set(cid, (sizeByCommunity.get(cid) || 0) + 1);
    }
  }

  const palette = [
    '#e6194b','#3cb44b','#ffe119','#0082c8','#f58231','#911eb4','#46f0f0','#f032e6','#d2f53c','#fabebe',
    '#008080','#e6beff','#aa6e28','#800000','#aaffc3','#808000','#ffd8b1','#000080','#bcf60c','#808080'
  ];

  const topCommunities = Array.from(sizeByCommunity.entries())
    .map(([cid, size]) => ({ cid: String(cid), size: Number(size || 0) }))
    .filter(g => g.size > 1)
    .sort((a, b) => {
      if (b.size !== a.size) return b.size - a.size;
      // stable tie-break by community id for deterministic assignment
      return a.cid.localeCompare(b.cid);
    })
    .slice(0, 10);

  const colorByCommunity: Record<string, string> = {};
  topCommunities.forEach((g, idx) => { colorByCommunity[g.cid] = palette[idx % palette.length]; });

  return colorByCommunity;
}
