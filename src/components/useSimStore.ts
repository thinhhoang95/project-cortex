"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Trajectory, SectorFeatureProps, RegulationPlanSimulationResponse, AlternativeRouteResponse, AlternativeRouteSegment } from "@/lib/models";
import { normalizeFlowBasketItemsStrict } from "@/lib/flightIdentity";
import type { RerouteImpactResponse } from "@/lib/rerouteImpact";
import type { RerouteFunnel, RerouteGeometryResult, RerouteObstacle } from "@/lib/rerouteGeometry";
import type { ResourceStateSummary, ResourceStateSyncPayload } from "@/lib/resourceStates";
import {
  applyCumulativeDelaysToTrajectories,
  computeTrajectoryRange,
} from "@/lib/resourceStates";
import { toggleOrderedTrafficVolumes } from "@/lib/multiTrafficVolumeSelection";
import {
  collectAllProposalFlights,
  collectProposalFlights,
  ProposeRegulationsRequest,
  ProposeRegulationsResponse,
  proposeRegulations,
} from "@/lib/regulationProposals";
import type { ProposalRegulationSource } from "@/lib/regulationProposalToPlan";
import { TV_DCB_GLANCE_DEFAULT_HORIZON_MINUTES } from "@/lib/tvDcbGlance";

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

const MAX_SELECTED_TRAFFIC_VOLUMES = 5;

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

export interface Regulation {
  id: string;
  trafficVolume: string;
  activeTimeWindowFrom: number;
  activeTimeWindowTo: number;
  flightIds: string[];
  flightCallsigns?: string[];
  resourceDate: string | null;
  resourceStateId: string | null;
  rate: number;
  proposalSource?: ProposalRegulationSource | null;
  createdAt: number;
}

export type ProposalQuery = {
  trafficVolumeId: string;
  timeWindow: string;
  topK?: number;
  threshold?: number;
  resolution?: number;
};

export type RerouteBaseListSource = "tv" | "query" | "catcher";
export type RerouteCatcherMode = "off" | "include" | "exclude";
export type RerouteCatcherTimeframe = "15m" | "30m" | "45m" | "1h" | "2h" | "3h" | "4h" | "all";
export type RerouteShapeToolMode = "off" | "obstacle" | "funnel";
export type ReroutePreviewMode = "current" | "rerouted";
export type RerouteCommittedMove = {
  id: string;
  createdAtEpochMs: number;
  label: string;
  affectedFlightIds: string[];
  obstacles: RerouteObstacle[];
  funnels: RerouteFunnel[];
};
export type RegulationCatcherMode = "off" | "include" | "exclude";
export type RegulationCatcherTimeframe = "15m" | "30m" | "45m" | "1h" | "2h" | "3h" | "4h" | "all";

type State = {
  t: number;               // current sim time (s)
  range: [number, number]; // global window
  speed: number;
  playing: boolean;
  resourceDate: string | null; // canonical operation date in YYYY-MM-DD
  resourceStateSelectedId: string | null;
  resourceStateHeadId: string | null;
  resourceStateZeroId: string | null;
  resourceStateStates: ResourceStateSummary[];
  resourceStateHistoryGeneration: number;
  resourceStateSelectedCumulativeDelaysMin: Record<string, number>;
  resourceStatePendingId: string | null;
  resourceStateError: string | null;
  resourceStateLoading: boolean;
  resourceStateEpoch: number;
  // Weather overlay selection
  weatherOverlay: 'none' | 'surface-precip';
  showFlightLineLabels: boolean;
  showCallsigns: boolean;
  showFlightLines: boolean;
  showWaypoints: boolean;
  showTrafficVolumes: boolean;
  airspaceDisplayMode: "tv" | "es";
  selectedTrafficVolume: string | null;
  selectedTrafficVolumes: string[];
  selectedTrafficVolumeData: { properties: SectorFeatureProps } | null;
  selectedCollapsedSector: string | null;
  selectedCollapsedSectorData: { properties: SectorFeatureProps } | null;
  flLowerBound: number;
  flUpperBound: number;
  baselineFlights: Trajectory[];
  flights: Trajectory[];
  focusMode: boolean;
  focusFlightIds: Set<string>;
  // Alternative Routes State
  selectedFlightForAnalysis: string | null;
  alternativeRoutes: Record<string, AlternativeRouteSegment[]> | null;
  isAlternativeRoutesPanelOpen: boolean;
  alternativeRoutesLoading: boolean;
  alternativeRoutesError: string | null;
  hoveredAlternativeRoute: string | null;
  showHotspots: boolean;
  hotspots: Hotspot[];
  hotspotsLoading: boolean;
  hotspotsMetadata: HotspotResponse["metadata"] | null;
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
  flightLinePreviewFlightIds: Set<string>;
  // Regulation Design state
  regulationTargetFlightIds: Set<string>;
  regulationPreviewActive: boolean;
  regulationVisibleFlightIds: string[];
  regulationListedFlightIds: string[]; // full list (not limited by UI expansion)
  regulationTimeWindow: [number, number];
  regulationRate: number;
  regulations: Regulation[];
  isRegulationPanelOpen: boolean;
  // Regulation proposals
  isRegulationProposalPanelOpen: boolean;
  proposalLoading: boolean;
  proposalError: string | null;
  proposalQuery: ProposalQuery | null;
  proposalResults: ProposeRegulationsResponse | null;
  proposalPreviewActive: boolean;
  proposalPreviewFlightIds: Set<string>;
  proposalPreviewProposalId: string | null;
  proposalPreviewAll: boolean;
  proposalHoverFlightIds: Set<string>;
  proposalPinnedProposals: Set<string>;
  proposalPinnedFlows: Set<string>;
  proposalPinnedFlightIds: Set<string>;
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
  glanceHorizonMinutes: number;
  // Reroute state
  rerouteBaseFlightIds: string[];
  rerouteTvBaselineFlightIds: string[];
  rerouteBaseSelectedFlightIds: Set<string>;
  rerouteBaseListLastSource: RerouteBaseListSource | null;
  rerouteCatcherMode: RerouteCatcherMode;
  rerouteCatcherTimeframe: RerouteCatcherTimeframe;
  rerouteCatcherActive: boolean;
  rerouteShapeToolMode: RerouteShapeToolMode;
  rerouteObstacles: RerouteObstacle[];
  rerouteFunnels: RerouteFunnel[];
  rerouteSelectedShape: { kind: "obstacle" | "funnel"; id: string } | null;
  rerouteCommittedMoves: RerouteCommittedMove[];
  rerouteGeometryResult: RerouteGeometryResult | null;
  rerouteProgramGeometryResult: RerouteGeometryResult | null;
  rerouteDraftMoveGeometryResult: RerouteGeometryResult | null;
  rerouteMoveResultsById: Record<string, RerouteGeometryResult | null>;
  rerouteGeometryComputing: boolean;
  rerouteGeometryError: string | null;
  reroutePreviewMode: ReroutePreviewMode;
  rerouteImpactResult: RerouteImpactResponse | null;
  isRerouteImpactResultsOpen: boolean;
  rerouteImpactScenarioSignature: string | null;
  regulationCatcherMode: RegulationCatcherMode;
  regulationCatcherTimeframe: RegulationCatcherTimeframe;
  regulationCatcherActive: boolean;
  // View options control (global minimized state so other UI can react)
  viewOptionsMinimized: boolean;
  // User state
  user: User | null;
  setRegulationVisibleFlightIds: (ids: string[]) => void;
  setRegulationListedFlightIds: (ids: string[]) => void;
  setRegulationPreviewActive: (active: boolean) => void;
  setRange: (r: [number, number], t?: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (v: number) => void;
  setResourceDate: (date: string | null) => void;
  clearResourceDate: () => void;
  setResourceStateLoading: (loading: boolean) => void;
  setResourceStatePendingId: (stateId: string | null) => void;
  setResourceStateError: (error: string | null) => void;
  syncResourceState: (payload: ResourceStateSyncPayload) => void;
  clearResourceState: () => void;
  setWeatherOverlay: (overlay: 'none' | 'surface-precip') => void;
  setShowFlightLineLabels: (show: boolean) => void;
  setShowCallsigns: (show: boolean) => void;
  setShowFlightLines: (show: boolean) => void;
  setShowWaypoints: (show: boolean) => void;
  setShowTrafficVolumes: (show: boolean) => void;
  setAirspaceDisplayMode: (mode: "tv" | "es") => void;
  setSelectedTrafficVolume: (tv: string | null, tvData?: { properties: SectorFeatureProps } | null) => void;
  toggleSelectedTrafficVolume: (tv: string, tvData?: { properties: SectorFeatureProps } | null) => { changed: boolean; reason?: "max_limit" };
  clearSelectedTrafficVolumes: () => void;
  setSelectedCollapsedSector: (sectorId: string | null, sectorData?: { properties: SectorFeatureProps } | null) => void;
  setFlLowerBound: (fl: number) => void;
  setFlUpperBound: (fl: number) => void;
  setFlRange: (lower: number, upper: number) => void;
  setBaselineFlights: (flights: Trajectory[]) => Trajectory[];
  setFlights: (flights: Trajectory[]) => void;
  setFocusMode: (enabled: boolean) => void;
  setFocusFlightIds: (flightIds: Set<string>) => void;
  setT: (t: number) => void;
  tick: (dtMs: number) => void;
  setShowHotspots: (show: boolean) => void;
  setHotspots: (hotspots: Hotspot[]) => void;
  setHotspotsLoading: (loading: boolean) => void;
  setHotspotsMetadata: (metadata: HotspotResponse["metadata"] | null) => void;
  // Flow view actions
  setFlowViewEnabled: (enabled: boolean) => void;
  setFlowThreshold: (threshold: number) => void;
  setFlowResolution: (resolution: number) => void;
  setFlowCommunities: (communities: Record<string, number> | null, groups?: Record<string, string[]> | null, colorOverride?: Record<string, string> | null) => void;
  setFlowLoading: (loading: boolean) => void;
  setFlowError: (error: string | null) => void;
  setFlowPreviewGroupId: (groupId: string | null) => void;
  setFlowPreviewFlightId: (flightId: string | null) => void;
  setFlightLinePreviewFlightIds: (flightIds: Set<string>) => void;
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
  setIsRegulationProposalPanelOpen: (open: boolean) => void;
  fetchRegulationProposals: (q: ProposalQuery) => Promise<void>;
  setProposalPreview: (ids: Set<string>, proposalId?: string | null) => void;
  clearProposalPreview: () => void;
  toggleProposalEye: (proposalId: string) => void;
  toggleProposalFlowEye: (proposalId: string, flowId: string | number) => void;
  togglePreviewAllProposals: () => void;
  resetProposalState: () => void;
  setRegulationEditPayload: (p: Omit<Regulation, 'id' | 'createdAt'> | null) => void;
  setRegulationSimulationResult: (r: RegulationPlanSimulationResponse | null) => void;
  setIsResultsOpen: (open: boolean) => void;
  // Slack view actions
  setSlackMode: (mode: "off" | "minus" | "plus") => void;
  setSlackSign: (sign: "minus" | "plus") => void;
  setIsFetchingSlack: (fetching: boolean) => void;
  setDeltaMin: (delta: number) => void;
  setGlanceHorizonMinutes: (minutes: number) => void;
  // Reroute actions
  setRerouteBaseFlightIds: (ids: string[], source?: RerouteBaseListSource) => void;
  setRerouteBaseSelectedFlightIds: (ids: Set<string>) => void;
  addRerouteBaseFlightIds: (ids: string[], source?: "catcher") => void;
  removeRerouteBaseFlightIds: (ids: string[], source?: "catcher") => void;
  clearRerouteBaseFlightIds: () => void;
  setRerouteCatcherMode: (mode: RerouteCatcherMode) => void;
  setRerouteCatcherTimeframe: (timeframe: RerouteCatcherTimeframe) => void;
  cancelRerouteCatcher: () => void;
  setRerouteShapeToolMode: (mode: RerouteShapeToolMode) => void;
  addRerouteObstacle: (vertices: [number, number][]) => string;
  removeRerouteObstacle: (id: string) => void;
  clearRerouteObstacles: () => void;
  addRerouteFunnel: (affinityPoint: [number, number], selectionPolyline: [number, number][]) => string;
  removeRerouteFunnel: (id: string) => void;
  clearRerouteFunnels: () => void;
  setRerouteSelectedShape: (shape: { kind: "obstacle" | "funnel"; id: string } | null) => void;
  removeRerouteSelectedShape: () => void;
  commitRerouteDraftMove: () => string;
  deleteRerouteMove: (id: string) => void;
  setRerouteGeometryResult: (result: RerouteGeometryResult | null) => void;
  setRerouteProgramGeometryResult: (result: RerouteGeometryResult | null) => void;
  setRerouteDraftMoveGeometryResult: (result: RerouteGeometryResult | null) => void;
  setRerouteMoveResultsById: (results: Record<string, RerouteGeometryResult | null>) => void;
  setRerouteGeometryComputing: (computing: boolean) => void;
  setRerouteGeometryError: (error: string | null) => void;
  toggleReroutePreviewMode: () => void;
  setRerouteImpactResult: (result: RerouteImpactResponse | null) => void;
  setIsRerouteImpactResultsOpen: (open: boolean) => void;
  setRerouteImpactScenarioSignature: (signature: string | null) => void;
  setRegulationCatcherMode: (mode: RegulationCatcherMode) => void;
  setRegulationCatcherTimeframe: (timeframe: RegulationCatcherTimeframe) => void;
  cancelRegulationCatcher: () => void;
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
  // Alternative Routes actions
  setSelectedFlightForAnalysis: (flightId: string | null) => void;
  closeAlternativeRoutesPanel: () => void;
  setHoveredAlternativeRoute: (route: string | null) => void;
  fetchAlternativeRoutes: (flightId: string) => Promise<void>;
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
  | 'resourceDate'
  | 'resourceStateSelectedId'
  | 'resourceStateHeadId'
  | 'resourceStateZeroId'
  | 'resourceStateStates'
  | 'resourceStateHistoryGeneration'
  | 'resourceStateSelectedCumulativeDelaysMin'
  | 'resourceStatePendingId'
  | 'resourceStateError'
  | 'resourceStateLoading'
  | 'resourceStateEpoch'
  | 'weatherOverlay'
  | 'showFlightLineLabels'
  | 'showCallsigns'
  | 'showFlightLines'
  | 'showWaypoints'
  | 'showTrafficVolumes'
  | 'airspaceDisplayMode'
  | 'selectedTrafficVolume'
  | 'selectedTrafficVolumes'
  | 'selectedTrafficVolumeData'
  | 'selectedCollapsedSector'
  | 'selectedCollapsedSectorData'
  | 'flLowerBound'
  | 'flUpperBound'
  | 'baselineFlights'
  | 'flights'
  | 'focusMode'
  | 'focusFlightIds'
  | 'selectedFlightForAnalysis'
  | 'alternativeRoutes'
  | 'isAlternativeRoutesPanelOpen'
  | 'alternativeRoutesLoading'
  | 'alternativeRoutesError'
  | 'hoveredAlternativeRoute'
  | 'showHotspots'
  | 'hotspots'
  | 'hotspotsLoading'
  | 'hotspotsMetadata'
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
  | 'flightLinePreviewFlightIds'
  | 'regulationTargetFlightIds'
  | 'regulationPreviewActive'
  | 'regulationVisibleFlightIds'
  | 'regulationListedFlightIds'
  | 'regulationTimeWindow'
  | 'regulationRate'
  | 'regulations'
  | 'isRegulationPanelOpen'
  | 'isRegulationProposalPanelOpen'
  | 'proposalLoading'
  | 'proposalError'
  | 'proposalQuery'
  | 'proposalResults'
  | 'proposalPreviewActive'
  | 'proposalPreviewFlightIds'
  | 'proposalPreviewProposalId'
  | 'proposalPreviewAll'
  | 'proposalHoverFlightIds'
  | 'proposalPinnedProposals'
  | 'proposalPinnedFlows'
  | 'proposalPinnedFlightIds'
  | 'regulationEditPayload'
  | 'regulationSimulationResult'
  | 'isResultsOpen'
  | 'targetCells'
  | 'flowBasket'
  | 'slackMode'
  | 'slackSign'
  | 'isFetchingSlack'
  | 'deltaMin'
  | 'glanceHorizonMinutes'
  | 'rerouteBaseFlightIds'
  | 'rerouteTvBaselineFlightIds'
  | 'rerouteBaseSelectedFlightIds'
  | 'rerouteBaseListLastSource'
  | 'rerouteCatcherMode'
  | 'rerouteCatcherTimeframe'
  | 'rerouteCatcherActive'
  | 'rerouteShapeToolMode'
  | 'rerouteObstacles'
  | 'rerouteFunnels'
  | 'rerouteSelectedShape'
  | 'rerouteCommittedMoves'
  | 'rerouteGeometryResult'
  | 'rerouteProgramGeometryResult'
  | 'rerouteDraftMoveGeometryResult'
  | 'rerouteMoveResultsById'
  | 'rerouteGeometryComputing'
  | 'rerouteGeometryError'
  | 'reroutePreviewMode'
  | 'rerouteImpactResult'
  | 'isRerouteImpactResultsOpen'
  | 'rerouteImpactScenarioSignature'
  | 'regulationCatcherMode'
  | 'regulationCatcherTimeframe'
  | 'regulationCatcherActive'
  | 'viewOptionsMinimized'
  | 'user'
> = {
  t: 0,
  range: [0, 24 * 3600],
  playing: false,
  speed: 1,
  resourceDate: null,
  resourceStateSelectedId: null,
  resourceStateHeadId: null,
  resourceStateZeroId: null,
  resourceStateStates: [],
  resourceStateHistoryGeneration: 0,
  resourceStateSelectedCumulativeDelaysMin: {},
  resourceStatePendingId: null,
  resourceStateError: null,
  resourceStateLoading: false,
  resourceStateEpoch: 0,
  weatherOverlay: 'none',
  showFlightLineLabels: false,
  showCallsigns: false,
  showFlightLines: true,
  showWaypoints: true,
  showTrafficVolumes: true,
  airspaceDisplayMode: "tv",
  selectedTrafficVolume: null,
  selectedTrafficVolumes: [],
  selectedTrafficVolumeData: null,
  selectedCollapsedSector: null,
  selectedCollapsedSectorData: null,
  flLowerBound: 0,
  flUpperBound: 500,
  baselineFlights: [],
  flights: [],
  focusMode: false,
  focusFlightIds: new Set<string>(),
  selectedFlightForAnalysis: null,
  alternativeRoutes: null,
  isAlternativeRoutesPanelOpen: false,
  alternativeRoutesLoading: false,
  alternativeRoutesError: null,
  hoveredAlternativeRoute: null,
  showHotspots: false,
  hotspots: [],
  hotspotsLoading: false,
  hotspotsMetadata: null,
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
  flightLinePreviewFlightIds: new Set<string>(),
  regulationTargetFlightIds: new Set<string>(),
  regulationPreviewActive: false,
  regulationVisibleFlightIds: [],
  regulationListedFlightIds: [],
  regulationTimeWindow: [0, 0],
  regulationRate: 0,
  regulations: [],
  isRegulationPanelOpen: false,
  isRegulationProposalPanelOpen: false,
  proposalLoading: false,
  proposalError: null,
  proposalQuery: null,
  proposalResults: null,
  proposalPreviewActive: false,
  proposalPreviewFlightIds: new Set<string>(),
  proposalPreviewProposalId: null,
  proposalPreviewAll: false,
  proposalHoverFlightIds: new Set<string>(),
  proposalPinnedProposals: new Set<string>(),
  proposalPinnedFlows: new Set<string>(),
  proposalPinnedFlightIds: new Set<string>(),
  regulationEditPayload: null,
  regulationSimulationResult: null,
  isResultsOpen: false,
  targetCells: [],
  flowBasket: [],
  slackMode: "off",
  slackSign: "minus",
  isFetchingSlack: false,
  deltaMin: 0,
  glanceHorizonMinutes: TV_DCB_GLANCE_DEFAULT_HORIZON_MINUTES,
  rerouteBaseFlightIds: [],
  rerouteTvBaselineFlightIds: [],
  rerouteBaseSelectedFlightIds: new Set<string>(),
  rerouteBaseListLastSource: null,
  rerouteCatcherMode: "off",
  rerouteCatcherTimeframe: "1h",
  rerouteCatcherActive: false,
  rerouteShapeToolMode: "off",
  rerouteObstacles: [],
  rerouteFunnels: [],
  rerouteSelectedShape: null,
  rerouteCommittedMoves: [],
  rerouteGeometryResult: null,
  rerouteProgramGeometryResult: null,
  rerouteDraftMoveGeometryResult: null,
  rerouteMoveResultsById: {},
  rerouteGeometryComputing: false,
  rerouteGeometryError: null,
  reroutePreviewMode: "rerouted",
  rerouteImpactResult: null,
  isRerouteImpactResultsOpen: false,
  rerouteImpactScenarioSignature: null,
  regulationCatcherMode: "off",
  regulationCatcherTimeframe: "1h",
  regulationCatcherActive: false,
  viewOptionsMinimized: false,
  user: null,
};

function cloneRerouteObstacle(obstacle: RerouteObstacle): RerouteObstacle {
  return {
    id: String(obstacle?.id ?? ""),
    vertices: (obstacle?.vertices || []).map((point) => [Number(point[0]), Number(point[1])] as [number, number]),
  };
}

function cloneRerouteFunnel(funnel: RerouteFunnel): RerouteFunnel {
  return {
    id: String(funnel?.id ?? ""),
    affinityPoint: [Number(funnel?.affinityPoint?.[0]), Number(funnel?.affinityPoint?.[1])],
    selectionPolyline: (funnel?.selectionPolyline || []).map(
      (point) => [Number(point[0]), Number(point[1])] as [number, number]
    ),
  };
}

function clampTimeToRange(t: number, range: [number, number]): number {
  if (!Number.isFinite(t)) return range[0];
  if (t < range[0]) return range[0];
  if (t > range[1]) return range[1];
  return t;
}

function deriveFlightsAndRange(
  baselineFlights: Trajectory[],
  cumulativeDelaysMin: Record<string, number>,
): { flights: Trajectory[]; range: [number, number] | null } {
  const flights = applyCumulativeDelaysToTrajectories(baselineFlights, cumulativeDelaysMin);
  return {
    flights,
    range: computeTrajectoryRange(flights),
  };
}

function delayMapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export const useSimStore = create(persist<State, [], [], Pick<State, 'user' | 'resourceDate'>>((set, get) => {
  const selectedTvDataCache = new Map<string, { properties: SectorFeatureProps } | null>();

  const recomputePinnedFlights = (
    nextPinnedProposals: Set<string>,
    nextPinnedFlows: Set<string>
  ) => {
    const flights = new Set<string>();
    const results = get().proposalResults;
    if (!results) return flights;
    for (const proposal of results.proposals || []) {
      if (nextPinnedProposals.has(proposal.id)) {
        collectProposalFlights(proposal).forEach((id) => flights.add(String(id)));
      }
      for (const flow of proposal.flows || []) {
        const key = `${proposal.id}::${flow.flow_id}`;
        if (nextPinnedFlows.has(key)) {
          for (const fid of flow.flight_ids || []) {
            flights.add(String(fid));
          }
        }
      }
    }
    return flights;
  };

  const applyProposalPreview = (opts?: {
    hover?: Set<string>;
    proposalId?: string | null;
    previewAll?: boolean;
  }) => {
    const state = get();
    const previewAll = opts?.previewAll ?? state.proposalPreviewAll;
    const base = previewAll
      ? collectAllProposalFlights(state.proposalResults)
      : new Set(state.proposalPinnedFlightIds);
    const hoverSet = opts?.hover
      ? new Set(Array.from(opts.hover).map(String))
      : new Set(state.proposalHoverFlightIds);
    const combined = new Set<string>();
    base.forEach((id) => combined.add(String(id)));
    hoverSet.forEach((id) => combined.add(String(id)));
    set({
      proposalPreviewAll: previewAll,
      proposalPreviewActive: combined.size > 0,
      proposalPreviewFlightIds: combined,
      proposalPreviewProposalId: opts?.proposalId ?? null,
      proposalHoverFlightIds: hoverSet,
    });
  };

  const buildResourceStateReset = (state: State) => {
    const { flights, range } = deriveFlightsAndRange(state.baselineFlights, {});
    const nextRange = range ?? state.range;

    return {
      resourceStateSelectedId: null,
      resourceStateHeadId: null,
      resourceStateZeroId: null,
      resourceStateStates: [] as ResourceStateSummary[],
      resourceStateHistoryGeneration: 0,
      resourceStateSelectedCumulativeDelaysMin: {},
      resourceStatePendingId: null,
      resourceStateError: null,
      resourceStateLoading: false,
      resourceStateEpoch: state.resourceStateEpoch + 1,
      regulationTargetFlightIds: new Set<string>(),
      regulationPreviewActive: false,
      regulationVisibleFlightIds: [],
      regulationListedFlightIds: [],
      regulationEditPayload: null,
      flights,
      range: nextRange,
      t: clampTimeToRange(state.t, nextRange),
    };
  };

  const buildResourceStateSync = (state: State, payload: ResourceStateSyncPayload) => {
    const nextDelays = payload.selectedCumulativeDelaysMin ?? {};
    const { flights, range } = deriveFlightsAndRange(state.baselineFlights, nextDelays);
    const nextRange = range ?? state.range;
    const selectionChanged = state.resourceStateSelectedId !== payload.selectedStateId;
    const generationChanged = state.resourceStateHistoryGeneration !== payload.stateHistoryGeneration;
    const delayMapChanged = !delayMapsEqual(state.resourceStateSelectedCumulativeDelaysMin, nextDelays);
    const invalidateServerDerivedState = selectionChanged || generationChanged || delayMapChanged;

    return {
      resourceStateSelectedId: payload.selectedStateId,
      resourceStateHeadId: payload.headStateId,
      resourceStateZeroId: payload.stateZeroId,
      resourceStateStates: payload.states.map((summary) => ({
        ...summary,
        is_selected: summary.state_id === payload.selectedStateId,
        is_head: summary.state_id === payload.headStateId,
        is_state_zero: summary.state_id === payload.stateZeroId,
      })),
      resourceStateHistoryGeneration: payload.stateHistoryGeneration,
      resourceStateSelectedCumulativeDelaysMin: { ...nextDelays },
      resourceStatePendingId: null,
      resourceStateError: null,
      resourceStateLoading: false,
      resourceStateEpoch:
        selectionChanged || generationChanged || delayMapChanged
          ? state.resourceStateEpoch + 1
          : state.resourceStateEpoch,
      hotspots: invalidateServerDerivedState ? [] : state.hotspots,
      hotspotsMetadata: invalidateServerDerivedState ? null : state.hotspotsMetadata,
      proposalLoading: invalidateServerDerivedState ? false : state.proposalLoading,
      proposalError: invalidateServerDerivedState ? null : state.proposalError,
      proposalQuery: invalidateServerDerivedState ? null : state.proposalQuery,
      proposalResults: invalidateServerDerivedState ? null : state.proposalResults,
      proposalPreviewActive: invalidateServerDerivedState ? false : state.proposalPreviewActive,
      proposalPreviewFlightIds: invalidateServerDerivedState ? new Set<string>() : state.proposalPreviewFlightIds,
      proposalPreviewProposalId: invalidateServerDerivedState ? null : state.proposalPreviewProposalId,
      proposalPreviewAll: invalidateServerDerivedState ? false : state.proposalPreviewAll,
      proposalHoverFlightIds: invalidateServerDerivedState ? new Set<string>() : state.proposalHoverFlightIds,
      proposalPinnedProposals: invalidateServerDerivedState ? new Set<string>() : state.proposalPinnedProposals,
      proposalPinnedFlows: invalidateServerDerivedState ? new Set<string>() : state.proposalPinnedFlows,
      proposalPinnedFlightIds: invalidateServerDerivedState ? new Set<string>() : state.proposalPinnedFlightIds,
      regulationTargetFlightIds: invalidateServerDerivedState ? new Set<string>() : state.regulationTargetFlightIds,
      regulationPreviewActive: invalidateServerDerivedState ? false : state.regulationPreviewActive,
      regulationVisibleFlightIds: invalidateServerDerivedState ? [] : state.regulationVisibleFlightIds,
      regulationListedFlightIds: invalidateServerDerivedState ? [] : state.regulationListedFlightIds,
      regulationEditPayload: invalidateServerDerivedState ? null : state.regulationEditPayload,
      regulationSimulationResult: invalidateServerDerivedState ? null : state.regulationSimulationResult,
      isResultsOpen: invalidateServerDerivedState ? false : state.isResultsOpen,
      flowCommunities: invalidateServerDerivedState ? null : state.flowCommunities,
      flowGroups: invalidateServerDerivedState ? null : state.flowGroups,
      flowColorByCommunity: invalidateServerDerivedState ? null : state.flowColorByCommunity,
      flowPreviewGroupId: invalidateServerDerivedState ? null : state.flowPreviewGroupId,
      flowPreviewFlightId: invalidateServerDerivedState ? null : state.flowPreviewFlightId,
      flightLinePreviewFlightIds: invalidateServerDerivedState ? new Set<string>() : state.flightLinePreviewFlightIds,
      rerouteImpactResult: invalidateServerDerivedState ? null : state.rerouteImpactResult,
      isRerouteImpactResultsOpen: invalidateServerDerivedState ? false : state.isRerouteImpactResultsOpen,
      rerouteImpactScenarioSignature: invalidateServerDerivedState ? null : state.rerouteImpactScenarioSignature,
      flights,
      range: nextRange,
      t: clampTimeToRange(state.t, nextRange),
    };
  };

  return {
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
    } catch {
      return { ok: false as const, error: 'Unable to sign in. Please try again.' };
    }
  },
  logout: () => {
    set({ user: null });
  },
  setRange: (r, t = get().t) => set({ range: r, t }),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (v) => set({ speed: v }),
  setResourceDate: (resourceDate) =>
    set((state) => ({
      resourceDate: resourceDate ? String(resourceDate).trim() : null,
      ...buildResourceStateReset(state),
      baselineFlights: [],
      flights: [],
      range: defaultState.range,
      t: defaultState.t,
      regulations: [],
      flowBasket: [],
      targetCells: [],
      rerouteBaseFlightIds: [],
      rerouteTvBaselineFlightIds: [],
      rerouteBaseSelectedFlightIds: new Set<string>(),
      rerouteBaseListLastSource: null,
    })),
  clearResourceDate: () =>
    set((state) => ({
      resourceDate: null,
      ...buildResourceStateReset(state),
      baselineFlights: [],
      flights: [],
      range: defaultState.range,
      t: defaultState.t,
      regulations: [],
      flowBasket: [],
      targetCells: [],
      rerouteBaseFlightIds: [],
      rerouteTvBaselineFlightIds: [],
      rerouteBaseSelectedFlightIds: new Set<string>(),
      rerouteBaseListLastSource: null,
    })),
  setResourceStateLoading: (loading) => set({ resourceStateLoading: loading }),
  setResourceStatePendingId: (stateId) => set({ resourceStatePendingId: stateId }),
  setResourceStateError: (error) => set({ resourceStateError: error, resourceStatePendingId: null, resourceStateLoading: false }),
  syncResourceState: (payload) => set((state) => buildResourceStateSync(state, payload)),
  clearResourceState: () => set((state) => buildResourceStateReset(state)),
  setWeatherOverlay: (overlay) => set({ weatherOverlay: overlay }),
  setShowFlightLineLabels: (show) => set({ showFlightLineLabels: show }),
  setShowCallsigns: (show) => set({ showCallsigns: show }),
  setShowFlightLines: (show) => set({ showFlightLines: show }),
  setShowWaypoints: (show) => set({ showWaypoints: show }),
  setShowTrafficVolumes: (show) => set({ showTrafficVolumes: show }),
  setAirspaceDisplayMode: (mode) => set({ airspaceDisplayMode: mode }),
  setSelectedTrafficVolume: (tv, tvData = null) => {
    const nextTv = tv ? String(tv) : null;
    if (nextTv) {
      selectedTvDataCache.set(nextTv, tvData ?? null);
    } else {
      selectedTvDataCache.clear();
    }
    const nextSelectedTrafficVolumes = nextTv ? [nextTv] : [];
    // Selecting a traffic volume should open the Regulation panel in Regulations view
    // Clearing the selection should close it for consistency across views
    set({
      selectedTrafficVolume: nextTv,
      selectedTrafficVolumes: nextSelectedTrafficVolumes,
      selectedTrafficVolumeData: nextTv ? (tvData ?? null) : null,
      selectedCollapsedSector: null,
      selectedCollapsedSectorData: null,
      isRegulationPanelOpen: !!nextTv,
    });
  },
  toggleSelectedTrafficVolume: (tv, tvData = null) => {
    const nextTv = String(tv ?? "").trim();
    if (!nextTv) return { changed: false };
    if (tvData !== undefined) {
      selectedTvDataCache.set(nextTv, tvData ?? null);
    }

    const state = get();
    const result = toggleOrderedTrafficVolumes(
      state.selectedTrafficVolumes,
      nextTv,
      MAX_SELECTED_TRAFFIC_VOLUMES,
    );
    if (!result.changed) {
      return { changed: false, reason: result.reason };
    }

    const nextPrimaryId = result.selectedTrafficVolumes[0] ?? null;
    const nextPrimaryData = nextPrimaryId
      ? (nextPrimaryId === nextTv
          ? (tvData ?? selectedTvDataCache.get(nextPrimaryId) ?? null)
          : (selectedTvDataCache.get(nextPrimaryId) ?? null))
      : null;

    set({
      selectedTrafficVolumes: result.selectedTrafficVolumes,
      selectedTrafficVolume: nextPrimaryId,
      selectedTrafficVolumeData: nextPrimaryData,
      selectedCollapsedSector: null,
      selectedCollapsedSectorData: null,
      isRegulationPanelOpen: !!nextPrimaryId,
    });

    return { changed: true };
  },
  clearSelectedTrafficVolumes: () => {
    selectedTvDataCache.clear();
    set({
      selectedTrafficVolumes: [],
      selectedTrafficVolume: null,
      selectedTrafficVolumeData: null,
      isRegulationPanelOpen: false,
    });
  },
  setSelectedCollapsedSector: (sectorId, sectorData = null) => {
    selectedTvDataCache.clear();
    set({
      selectedCollapsedSector: sectorId,
      selectedCollapsedSectorData: sectorData,
      selectedTrafficVolumes: [],
      selectedTrafficVolume: null,
      selectedTrafficVolumeData: null,
      isRegulationPanelOpen: false,
    });
  },
  setFlLowerBound: (fl) => set({ flLowerBound: fl }),
  setFlUpperBound: (fl) => set({ flUpperBound: fl }),
  setFlRange: (lower, upper) => set({ flLowerBound: lower, flUpperBound: upper }),
  setBaselineFlights: (baselineFlights) => {
    const state = get();
    const { flights, range } = deriveFlightsAndRange(baselineFlights, state.resourceStateSelectedCumulativeDelaysMin);
    const nextRange = range ?? state.range;
    const nextT = range ? clampTimeToRange(state.t, nextRange) : state.t;
    set({
      baselineFlights,
      flights,
      range: nextRange,
      t: nextT,
    });
    return flights;
  },
  setFlights: (flights) => set({ flights }),
  setFocusMode: (enabled) => set({ focusMode: enabled }),
  setFocusFlightIds: (flightIds) => set({ focusFlightIds: flightIds }),
  setSelectedFlightForAnalysis: (flightId) => {
    if (flightId) {
      selectedTvDataCache.clear();
      set({
        selectedFlightForAnalysis: flightId,
        selectedTrafficVolumes: [],
        selectedTrafficVolume: null,
        selectedTrafficVolumeData: null,
        selectedCollapsedSector: null,
        selectedCollapsedSectorData: null,
        focusMode: true,
        focusFlightIds: new Set([flightId]),
        isAlternativeRoutesPanelOpen: true,
        alternativeRoutesError: null,
        hoveredAlternativeRoute: null,
      });
      get().fetchAlternativeRoutes(flightId);
    } else {
      selectedTvDataCache.clear();
      set({
        selectedFlightForAnalysis: null,
        alternativeRoutes: null,
        alternativeRoutesError: null,
        isAlternativeRoutesPanelOpen: false,
        alternativeRoutesLoading: false,
        hoveredAlternativeRoute: null,
        selectedTrafficVolumes: [],
        selectedTrafficVolume: null,
        selectedTrafficVolumeData: null,
        selectedCollapsedSector: null,
        selectedCollapsedSectorData: null,
        focusMode: false,
        focusFlightIds: new Set<string>(),
      });
    }
  },
  closeAlternativeRoutesPanel: () => {
    get().setSelectedFlightForAnalysis(null);
  },
  setHoveredAlternativeRoute: (route) => set({ hoveredAlternativeRoute: route }),
  fetchAlternativeRoutes: async (flightId: string) => {
    const { user } = get();
    if (!user || !user.token) return;

    set({
      alternativeRoutesLoading: true,
      alternativeRoutesError: null,
      alternativeRoutes: null,
      hoveredAlternativeRoute: null,
    });

    try {
      const response = await fetch(
        `/api/predict_single_flight?flight_identifier=${encodeURIComponent(flightId)}`,
        {
          headers: {
            Authorization: `Bearer ${user.token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const data: AlternativeRouteResponse = await response.json();
      const grouped: Record<string, AlternativeRouteSegment[]> = {};

      (data.segments || []).forEach((seg) => {
        const routeKey = seg.route || "unknown";
        if (!grouped[routeKey]) {
          grouped[routeKey] = [];
        }
        grouped[routeKey].push(seg);
      });

      Object.values(grouped).forEach((segments) => {
        segments.sort((a, b) => a.time_begin_segment - b.time_begin_segment);
      });

      set({
        alternativeRoutes: grouped,
        alternativeRoutesLoading: false,
      });
    } catch (err: any) {
      set({
        alternativeRoutesError: err?.message ? String(err.message) : String(err),
        alternativeRoutesLoading: false,
      });
    }
  },
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
  setHotspotsMetadata: (metadata) => set({ hotspotsMetadata: metadata }),
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
  setFlightLinePreviewFlightIds: (flightIds) => set({ flightLinePreviewFlightIds: flightIds }),
  setFlowColorByCommunity: (m) => set({ flowColorByCommunity: m }),
  setRegulationVisibleFlightIds: (ids) => set({ regulationVisibleFlightIds: ids }),
  setRegulationListedFlightIds: (ids) => set({ regulationListedFlightIds: ids }),
  setRegulationPreviewActive: (active) => set({ regulationPreviewActive: active }),
  fetchHotspots: async (threshold: number = 0.0) => {
    const requestEpoch = get().resourceStateEpoch;
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

      if (get().resourceStateEpoch !== requestEpoch) {
        return;
      }

      // Hotspots are already sorted by z_max in the API
      set({
        hotspots: data.hotspots || [],
        hotspotsMetadata: data.metadata ?? null,
      });
    } catch (error) {
      console.error('Error fetching hotspots:', error);
      if (get().resourceStateEpoch !== requestEpoch) {
        return;
      }
      set({ hotspots: [], hotspotsMetadata: null });
    } finally {
      if (get().resourceStateEpoch === requestEpoch) {
        set({ hotspotsLoading: false });
      }
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
      id: `REG${Date.now()}${Math.floor(Math.random() * 1000)}`,
      createdAt: Date.now()
    };
    set(state => ({ regulations: [...state.regulations, newRegulation] }));
  },
  removeRegulation: (id) => {
    set(state => ({ regulations: state.regulations.filter(r => r.id !== id) }));
  },
  setIsRegulationPanelOpen: (open) => set({ isRegulationPanelOpen: open }),
  setIsRegulationProposalPanelOpen: (open) => set({ isRegulationProposalPanelOpen: open }),
  fetchRegulationProposals: async (q) => {
    const requestEpoch = get().resourceStateEpoch;
    set({
      isRegulationProposalPanelOpen: true,
      proposalLoading: true,
      proposalError: null,
      proposalQuery: q,
      proposalResults: null,
      proposalPreviewActive: false,
      proposalPreviewFlightIds: new Set<string>(),
      proposalPreviewProposalId: null,
      proposalPreviewAll: false,
      proposalHoverFlightIds: new Set<string>(),
      proposalPinnedProposals: new Set<string>(),
      proposalPinnedFlows: new Set<string>(),
      proposalPinnedFlightIds: new Set<string>(),
    });
    try {
      const body: ProposeRegulationsRequest = {
        traffic_volume_id: q.trafficVolumeId,
        time_window: q.timeWindow,
      };
      if (q.topK != null) {
        body.top_k_regulations = q.topK;
      }
      if (q.threshold != null) {
        body.threshold = q.threshold;
      }
      if (q.resolution != null) {
        body.resolution = q.resolution;
      }
      const data = await proposeRegulations(body);
      if (get().resourceStateEpoch !== requestEpoch) {
        return;
      }
      set({
        proposalResults: data,
        proposalLoading: false,
        proposalError: null,
      });
      applyProposalPreview({ hover: new Set<string>(), proposalId: null, previewAll: false });
    } catch (error: any) {
      if (get().resourceStateEpoch !== requestEpoch) {
        return;
      }
      set({
        proposalLoading: false,
        proposalError: error?.message || 'Failed to fetch regulation proposals',
      });
      applyProposalPreview({ hover: new Set<string>(), proposalId: null, previewAll: false });
    }
  },
  setProposalPreview: (ids, proposalId = null) => {
    applyProposalPreview({ hover: ids, proposalId: proposalId ?? null });
  },
  clearProposalPreview: () => {
    applyProposalPreview({ hover: new Set<string>(), proposalId: null });
  },
  toggleProposalEye: (proposalId) => {
    const state = get();
    if (!state.proposalResults) return;
    const nextPinnedProposals = new Set(state.proposalPinnedProposals);
    if (nextPinnedProposals.has(proposalId)) {
      nextPinnedProposals.delete(proposalId);
    } else {
      nextPinnedProposals.add(proposalId);
    }
    const nextPinnedFlows = new Set(state.proposalPinnedFlows);
    const nextPinnedFlights = recomputePinnedFlights(nextPinnedProposals, nextPinnedFlows);
    set({
      proposalPinnedProposals: nextPinnedProposals,
      proposalPinnedFlows: nextPinnedFlows,
      proposalPinnedFlightIds: nextPinnedFlights,
    });
    applyProposalPreview();
  },
  toggleProposalFlowEye: (proposalId, flowId) => {
    const state = get();
    if (!state.proposalResults) return;
    const key = `${proposalId}::${flowId}`;
    const nextPinnedFlows = new Set(state.proposalPinnedFlows);
    if (nextPinnedFlows.has(key)) {
      nextPinnedFlows.delete(key);
    } else {
      nextPinnedFlows.add(key);
    }
    const nextPinnedProposals = new Set(state.proposalPinnedProposals);
    const nextPinnedFlights = recomputePinnedFlights(nextPinnedProposals, nextPinnedFlows);
    set({
      proposalPinnedProposals: nextPinnedProposals,
      proposalPinnedFlows: nextPinnedFlows,
      proposalPinnedFlightIds: nextPinnedFlights,
    });
    applyProposalPreview();
  },
  togglePreviewAllProposals: () => {
    const state = get();
    const nextAll = !state.proposalPreviewAll;
    applyProposalPreview({
      hover: state.proposalHoverFlightIds,
      proposalId: null,
      previewAll: nextAll,
    });
  },
  resetProposalState: () => {
    set({
      isRegulationProposalPanelOpen: false,
      proposalLoading: false,
      proposalError: null,
      proposalQuery: null,
      proposalResults: null,
      proposalPreviewActive: false,
      proposalPreviewFlightIds: new Set<string>(),
      proposalPreviewProposalId: null,
      proposalPreviewAll: false,
      proposalHoverFlightIds: new Set<string>(),
      proposalPinnedProposals: new Set<string>(),
      proposalPinnedFlows: new Set<string>(),
      proposalPinnedFlightIds: new Set<string>(),
    });
  },
  setRegulationEditPayload: (p) => set({ regulationEditPayload: p }),
  setRegulationSimulationResult: (r) => set({ regulationSimulationResult: r }),
  setIsResultsOpen: (open) => set({ isResultsOpen: open }),
  // Slack view actions
  setSlackMode: (mode) => set({ slackMode: mode }),
  setSlackSign: (sign) => set({ slackSign: sign }),
  setIsFetchingSlack: (fetching) => set({ isFetchingSlack: fetching }),
  setDeltaMin: (delta) => set({ deltaMin: delta }),
  setGlanceHorizonMinutes: (minutes) =>
    set({
      glanceHorizonMinutes:
        Number.isFinite(minutes) && minutes > 0
          ? Math.round(minutes)
          : TV_DCB_GLANCE_DEFAULT_HORIZON_MINUTES,
    }),
  setRerouteBaseFlightIds: (ids, source = "tv") => {
    const next: string[] = [];
    const seen = new Set<string>();
    for (const raw of ids || []) {
      const normalized = String(raw ?? "").trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      next.push(normalized);
    }
    set({
      rerouteBaseFlightIds: next,
      rerouteBaseSelectedFlightIds: new Set(next),
      ...(source === "tv" ? { rerouteTvBaselineFlightIds: next } : {}),
      rerouteBaseListLastSource: source,
    });
  },
  setRerouteBaseSelectedFlightIds: (ids) => {
    set((state) => {
      const allowed = new Set(state.rerouteBaseFlightIds);
      const next = new Set<string>();
      for (const raw of ids) {
        const normalized = String(raw ?? "").trim();
        if (!normalized || !allowed.has(normalized)) continue;
        next.add(normalized);
      }
      return { rerouteBaseSelectedFlightIds: next };
    });
  },
  addRerouteBaseFlightIds: (ids, source = "catcher") => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    set((state) => {
      const existing = state.rerouteBaseFlightIds;
      const nextSelected = new Set(state.rerouteBaseSelectedFlightIds);
      const seen = new Set(existing);
      const next = existing.slice();
      for (const raw of ids) {
        const normalized = String(raw ?? "").trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        next.push(normalized);
        nextSelected.add(normalized);
      }
      return {
        rerouteBaseFlightIds: next,
        rerouteBaseSelectedFlightIds: nextSelected,
        rerouteBaseListLastSource: source,
      };
    });
  },
  removeRerouteBaseFlightIds: (ids, source = "catcher") => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const removeSet = new Set(
      ids
        .map((raw) => String(raw ?? "").trim())
        .filter((id) => id.length > 0)
    );
    if (removeSet.size === 0) return;
    set((state) => {
      const nextSelected = new Set(state.rerouteBaseSelectedFlightIds);
      for (const id of removeSet) {
        nextSelected.delete(id);
      }
      return {
        rerouteBaseFlightIds: state.rerouteBaseFlightIds.filter((id) => !removeSet.has(id)),
        rerouteBaseSelectedFlightIds: nextSelected,
        rerouteBaseListLastSource: source,
      };
    });
  },
  clearRerouteBaseFlightIds: () =>
    set({
      rerouteBaseFlightIds: [],
      rerouteTvBaselineFlightIds: [],
      rerouteBaseSelectedFlightIds: new Set<string>(),
      rerouteBaseListLastSource: null,
    }),
  setRerouteCatcherMode: (mode) =>
    set({
      rerouteCatcherMode: mode,
      rerouteCatcherActive: mode !== "off",
      rerouteShapeToolMode: "off",
      rerouteSelectedShape: null,
    }),
  setRerouteCatcherTimeframe: (timeframe) => set({ rerouteCatcherTimeframe: timeframe }),
  cancelRerouteCatcher: () =>
    set({
      rerouteCatcherMode: "off",
      rerouteCatcherActive: false,
    }),
  setRerouteShapeToolMode: (mode) =>
    set((state) => ({
      rerouteShapeToolMode: mode,
      ...(mode === "off" ? {} : {
        rerouteCatcherMode: "off" as RerouteCatcherMode,
        rerouteCatcherActive: false,
      }),
      ...(mode === "off" && state.rerouteSelectedShape ? { rerouteSelectedShape: null } : {}),
    })),
  addRerouteObstacle: (vertices) => {
    const normalized: [number, number][] = [];
    for (const point of vertices || []) {
      if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      const nextPoint: [number, number] = [Number(point[0]), Number(point[1])];
      const prev = normalized[normalized.length - 1];
      if (prev && Math.abs(prev[0] - nextPoint[0]) <= 1e-9 && Math.abs(prev[1] - nextPoint[1]) <= 1e-9) {
        continue;
      }
      normalized.push(nextPoint);
    }
    if (normalized.length < 3) return "";
    const id = `RO${Date.now()}${Math.floor(Math.random() * 1000)}`;
    set((state) => ({
      rerouteObstacles: [...state.rerouteObstacles, { id, vertices: normalized }],
      rerouteSelectedShape: { kind: "obstacle", id },
    }));
    return id;
  },
  removeRerouteObstacle: (id) => {
    const normalizedId = String(id ?? "").trim();
    if (!normalizedId) return;
    set((state) => ({
      rerouteObstacles: state.rerouteObstacles.filter((obstacle) => String(obstacle.id) !== normalizedId),
      rerouteSelectedShape:
        state.rerouteSelectedShape?.kind === "obstacle" && state.rerouteSelectedShape.id === normalizedId
          ? null
          : state.rerouteSelectedShape,
    }));
  },
  clearRerouteObstacles: () =>
    set((state) => ({
      rerouteObstacles: [],
      rerouteSelectedShape:
        state.rerouteSelectedShape?.kind === "obstacle" ? null : state.rerouteSelectedShape,
    })),
  addRerouteFunnel: (affinityPoint, selectionPolyline) => {
    if (
      !Array.isArray(affinityPoint) ||
      !Number.isFinite(affinityPoint[0]) ||
      !Number.isFinite(affinityPoint[1])
    ) {
      return "";
    }
    const normalizedSelection: [number, number][] = [];
    for (const point of selectionPolyline || []) {
      if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      const nextPoint: [number, number] = [Number(point[0]), Number(point[1])];
      const prev = normalizedSelection[normalizedSelection.length - 1];
      if (prev && Math.abs(prev[0] - nextPoint[0]) <= 1e-9 && Math.abs(prev[1] - nextPoint[1]) <= 1e-9) {
        continue;
      }
      normalizedSelection.push(nextPoint);
    }
    if (normalizedSelection.length < 3) return "";
    const id = `RF${Date.now()}${Math.floor(Math.random() * 1000)}`;
    set((state) => ({
      rerouteFunnels: [...state.rerouteFunnels, {
        id,
        affinityPoint: [Number(affinityPoint[0]), Number(affinityPoint[1])],
        selectionPolyline: normalizedSelection,
      }],
      rerouteSelectedShape: { kind: "funnel", id },
    }));
    return id;
  },
  removeRerouteFunnel: (id) => {
    const normalizedId = String(id ?? "").trim();
    if (!normalizedId) return;
    set((state) => ({
      rerouteFunnels: state.rerouteFunnels.filter((funnel) => String(funnel.id) !== normalizedId),
      rerouteSelectedShape:
        state.rerouteSelectedShape?.kind === "funnel" && state.rerouteSelectedShape.id === normalizedId
          ? null
          : state.rerouteSelectedShape,
    }));
  },
  clearRerouteFunnels: () =>
    set((state) => ({
      rerouteFunnels: [],
      rerouteSelectedShape:
        state.rerouteSelectedShape?.kind === "funnel" ? null : state.rerouteSelectedShape,
    })),
  setRerouteSelectedShape: (shape) => {
    if (!shape) {
      set({ rerouteSelectedShape: null });
      return;
    }
    const id = String(shape.id ?? "").trim();
    if (!id) {
      set({ rerouteSelectedShape: null });
      return;
    }
    if (shape.kind !== "obstacle" && shape.kind !== "funnel") {
      set({ rerouteSelectedShape: null });
      return;
    }
    set({ rerouteSelectedShape: { kind: shape.kind, id } });
  },
  removeRerouteSelectedShape: () =>
    set((state) => {
      const selected = state.rerouteSelectedShape;
      if (!selected) return {};
      if (selected.kind === "obstacle") {
        return {
          rerouteObstacles: state.rerouteObstacles.filter((obstacle) => String(obstacle.id) !== selected.id),
          rerouteSelectedShape: null,
        };
      }
      return {
        rerouteFunnels: state.rerouteFunnels.filter((funnel) => String(funnel.id) !== selected.id),
        rerouteSelectedShape: null,
      };
    }),
  commitRerouteDraftMove: () => {
    const state = get();
    const hasDraftGeometry = state.rerouteObstacles.length > 0 || state.rerouteFunnels.length > 0;
    const draftResult = state.rerouteDraftMoveGeometryResult;
    if (!hasDraftGeometry || !draftResult || draftResult.changedFlightCount <= 0) {
      return "";
    }

    const id = `RM${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const affectedFlightIds = Array.from(
      new Set(
        (draftResult.flights || [])
          .map((flight) => String(flight.flightId ?? "").trim())
          .filter((flightId) => flightId.length > 0)
      )
    );
    if (affectedFlightIds.length === 0) return "";

    set((current) => ({
      rerouteCommittedMoves: [
        ...current.rerouteCommittedMoves,
        {
          id,
          createdAtEpochMs: Date.now(),
          label: `Move ${current.rerouteCommittedMoves.length + 1}`,
          affectedFlightIds,
          obstacles: current.rerouteObstacles.map(cloneRerouteObstacle),
          funnels: current.rerouteFunnels.map(cloneRerouteFunnel),
        },
      ],
      rerouteObstacles: [],
      rerouteFunnels: [],
      rerouteSelectedShape: null,
      rerouteShapeToolMode: "off",
      rerouteDraftMoveGeometryResult: null,
      rerouteGeometryComputing: true,
    }));
    return id;
  },
  deleteRerouteMove: (id) => {
    const normalizedId = String(id ?? "").trim();
    if (!normalizedId) return;
    set((state) => ({
      rerouteCommittedMoves: state.rerouteCommittedMoves.filter((move) => String(move.id) !== normalizedId),
      rerouteGeometryComputing: true,
    }));
  },
  setRerouteGeometryResult: (result) =>
    set({
      rerouteGeometryResult: result,
      rerouteProgramGeometryResult: result,
    }),
  setRerouteProgramGeometryResult: (result) =>
    set({
      rerouteProgramGeometryResult: result,
      rerouteGeometryResult: result,
    }),
  setRerouteDraftMoveGeometryResult: (result) => set({ rerouteDraftMoveGeometryResult: result }),
  setRerouteMoveResultsById: (results) => set({ rerouteMoveResultsById: results }),
  setRerouteGeometryComputing: (computing) => set({ rerouteGeometryComputing: computing }),
  setRerouteGeometryError: (error) => set({ rerouteGeometryError: error }),
  toggleReroutePreviewMode: () =>
    set((state) => ({
      reroutePreviewMode: state.reroutePreviewMode === "rerouted" ? "current" : "rerouted",
    })),
  setRerouteImpactResult: (result) => set({ rerouteImpactResult: result }),
  setIsRerouteImpactResultsOpen: (open) => set({ isRerouteImpactResultsOpen: open }),
  setRerouteImpactScenarioSignature: (signature) =>
    set({ rerouteImpactScenarioSignature: signature ? String(signature) : null }),
  setRegulationCatcherMode: (mode) =>
    set({
      regulationCatcherMode: mode,
      regulationCatcherActive: mode !== "off",
    }),
  setRegulationCatcherTimeframe: (timeframe) => set({ regulationCatcherTimeframe: timeframe }),
  cancelRegulationCatcher: () =>
    set({
      regulationCatcherMode: "off",
      regulationCatcherActive: false,
    }),
  setViewOptionsMinimized: (minimized) => set({ viewOptionsMinimized: minimized }),
  // Reset all stateful values back to defaults (used on page navigation)
  resetAll: () => {
    selectedTvDataCache.clear();
    set((state) => ({
      ...defaultState,
      user: state.user,
      resourceDate: state.resourceDate,
      resourceStateSelectedId: state.resourceStateSelectedId,
      resourceStateHeadId: state.resourceStateHeadId,
      resourceStateZeroId: state.resourceStateZeroId,
      resourceStateStates: state.resourceStateStates,
      resourceStateHistoryGeneration: state.resourceStateHistoryGeneration,
      resourceStateSelectedCumulativeDelaysMin: state.resourceStateSelectedCumulativeDelaysMin,
      resourceStatePendingId: state.resourceStatePendingId,
      resourceStateError: state.resourceStateError,
      resourceStateLoading: state.resourceStateLoading,
      resourceStateEpoch: state.resourceStateEpoch,
    }));
  }
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
    const normalized: FlowBasketItem[] = normalizeBasketItems(items, get().flights);
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
    const normalized: FlowBasketItem[] = normalizeBasketItems(items, get().flights);
    set(state => ({ flowBasket: [...state.flowBasket, { id, name: name || `Flow ${state.flowBasket.length+1}`, color, items: normalized, periodFrom, periodTo, createdAt }] }));
    return id;
  },
  createEmptyFlowBasket: (name?: string) => {
    return get().addFlowBasket(name || `Flow ${get().flowBasket.length+1}`, []);
  },
  removeFlowBasket: (id: string) => set(state => ({ flowBasket: state.flowBasket.filter(f => f.id !== id) })),
  addFlightsToBasketFlow: (id: string, items: Array<string | FlowBasketItem>) => {
    if (!items || items.length === 0) return;
    const normalized = normalizeBasketItems(items, get().flights);
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
  };
},
{
  name: 'sim-storage',
  partialize: (state) => ({ user: state.user, resourceDate: state.resourceDate }),
}
));

function normalizeBasketItems(items: Array<string | FlowBasketItem> | undefined, flights: Trajectory[]): FlowBasketItem[] {
  return normalizeFlowBasketItemsStrict(items, flights);
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
