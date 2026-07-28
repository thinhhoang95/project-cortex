'use client';

import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, List, Presentation } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { FocusEvent, HTMLAttributes, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import FlightListStatistics from '@/components/FlightListStatistics';
import AgentGaResultSummaryPanel from '@/components/AgentGaResultSummaryPanel';
import AgentSaResultSummaryPanel from '@/components/AgentSaResultSummaryPanel';
import FlightPathsMiniMap from '@/components/FlightPathsMiniMap';
import OccupancyPrePostPanel, {
  type OccupancyPrePostSortMode,
} from '@/components/OccupancyPrePostPanel';
import PerAccDelayAttributionPanel from '@/components/PerAccDelayAttributionPanel';
import PerStageRewardPanel, { type PerStageRewardEntry } from '@/components/PerStageRewardPanel';
import TrafficVolumeInfoTooltip from '@/components/TrafficVolumeInfoTooltip';
import TrafficVolumeMiniMap from '@/components/TrafficVolumeMiniMap';
import TimeScaleControl from '@/components/TimeScaleControl';
import ShimmeringText from '@/components/ShimmeringText';
import VpfDefiningVolumes from '@/components/VpfDefiningVolumes';
import { useSimStore } from '@/components/useSimStore';
import { useGlobalTVBasket } from '@/components/useGlobalTVBasket';
import { useGlobalTVBasketStore } from '@/components/useGlobalTVBasketStore';
import type {
  HotspotSegment,
  OccupancySeriesByTv,
  RegulationPlanPerAccAttrib,
  RegulationPlanPerAccAttribMode,
  Trajectory,
  WithHotspotDiffs,
} from '@/lib/models';
import { authFetch } from '@/lib/auth';
import type { AgentRunRef, AgentSolListRun } from '@/lib/agentRuns';
import { toAgentRunRef } from '@/lib/agentRuns';
import {
  buildFlowGroupMetadata,
  type FlowDefiningVolumeDisplay,
  type FlowGroupMetadata,
  type VpfFlowMetadata,
} from '@/lib/flowExtractor';
import { normalizePerAccAttribMode } from '@/lib/perAccAttribution';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface AgentSolSummaryResponse {
  runs: AgentRunSummary[];
}

interface AgentSolListResponse {
  runs: AgentSolListRun[];
}

interface AgentRunSummary {
  run_id: string;
  best_total_improvement: number | null;
  solutions: AgentSolutionSummary[];
  metadata?: AgentRunMetadata;
}

interface AgentRunBrowserEntry extends AgentSolListRun {
  ref: AgentRunRef;
  solutions: AgentSolutionSummary[];
  metadata?: AgentRunMetadata;
}

interface AgentSolutionSummary {
  rank: number;
  total_improvement: number | null;
  trajectory_length: number | null;
}

interface AgentRunMetadata {
  selected_row_kind?: string;
  last_updated?: string;
  total_rows?: number;
  source_csv?: string;
  historical_best?: HistoricalBestEntry[];
}

interface HistoricalBestEntry {
  ts_iso: string;
  best_total_improvement: number | null;
}

interface AgentSolBestResponse {
  run_id: string;
  solutions: AgentSolutionBest[];
  metadata?: Record<string, unknown>;
}

interface AgentSolutionBest {
  rank: number;
  proposal_rank?: number;
  metadata?: {
    last_updated?: string;
    [key: string]: unknown;
  };
  metrics?: Record<string, unknown>;
  steps: AgentSolutionStep[];
  regulations?: AgentSolutionRegulation[];
}

interface AgentSolutionStep {
  step_number: number;
  control_volume?: string;
  controlled_volume?: string;
  time_window?: string;
  timeWindow?: string;
  proposal_rank?: number;
  metadata?: Record<string, unknown>;
  regulations?: AgentSolutionRegulation[];
  [key: string]: unknown;
}

interface AgentSolutionRegulation {
  control_volume?: string;
  controlled_volume?: string;
  time_window?: string;
  timeWindow?: string;
  step_number?: number;
  stepNumber?: number;
  extractor_metadata?: Partial<VpfFlowMetadata> | null;
  [key: string]: unknown;
}

interface AgentSolDetailsResponse {
  trajectory_key?: string;
  selected_step?: AgentSolutionStep;
  selected_step_regulations?: AgentSolutionRegulation[];
  regulations?: AgentSolutionRegulation[];
  per_stage_reward?: PerStageRewardEntry[];
  step_delays_by_flight?: Record<string, AgentSolutionFlightDelay | number | string>;
  pre_post?: AgentSolutionPrePost;
  per_acc_attrib?: RegulationPlanPerAccAttrib;
  hotspot_segments?: AgentSolutionHotspotSegment[];
  metadata?: Record<string, unknown>;
}

interface AgentSolutionHotspotSegment extends HotspotSegment {
  startLabel?: string;
  endLabel?: string;
  [key: string]: unknown;
}

interface AgentSolutionFlightDelay {
  callsign?: string;
  call_sign?: string;
  origin?: string;
  destination?: string;
  delay_minutes?: number;
  delayMinutes?: number;
  delay_min?: number;
  delay?: number;
  targeted?: boolean;
  is_targeted?: boolean;
  selected?: boolean;
  is_selected?: boolean;
  [key: string]: unknown;
}

interface AgentSolutionPrePost extends WithHotspotDiffs {
  post_counts?: Record<string, number[]>;
  pre_counts?: Record<string, number[]>;
  capacity?: Record<string, number[]>;
  tv_ids_order?: string[];
  time_bin_minutes?: number;
  timebins?: { labels?: string[] };
  labels?: string[];
  [key: string]: unknown;
}

interface AgentResultSummaryComponentProps {
  className?: string;
  /**
   * Optional override for the API path (defaults to `/api/agent_sol_summary`)
   * to make mocking and testing easier.
   */
  endpoint?: string;
  initialRun?: AgentRunRef;
}

interface StepAggregate {
  flowCount: number;
  flightCount: number;
  flowIds: string[];
  flightIds: string[];
}

interface FlightRowData {
  flightId: string;
  callsign: string;
  origin: string;
  destination: string;
  delayMinutes: number;
  targeted: boolean;
}

type FlowGroupRow = FlightRowData;

interface FlowGroup {
  key: string;
  label: string;
  controlVolume?: string;
  timeWindow?: string;
  flowId?: string;
  baselineRate?: number | null;
  allowedRate?: number | null;
  metadata?: FlowGroupMetadata | null;
  flightIds: string[];
  rows: FlowGroupRow[];
}

interface FlowDefinitionRow {
  key: string;
  stepNumber: number | null;
  flowId?: string;
  controlVolume?: string;
  timeWindow?: string;
  baselineRate: number | null;
  allowedRate: number | null;
  flightCount: number | null;
  metadata: FlowGroupMetadata | null;
}

// Compact "H:/O:" defining-volume chain. H = hotspot (primary) segment,
// O = overload (secondary) segment, mirroring the raw `H:<TV>:<window>` encoding.
function DefiningVolumeChain({
  volumes,
  className = '',
}: {
  volumes: FlowDefiningVolumeDisplay[];
  className?: string;
}) {
  if (!volumes.length) return null;
  return (
    <div
      className={`no-scrollbar flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-x-auto text-[11px] ${className}`}
    >
      {volumes.map((volume, index) => (
        <span key={volume.key} className="contents">
          {index > 0 && <span className="shrink-0 text-white/30">→</span>}
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5">
            <span
              className={`font-mono font-semibold ${
                volume.isPrimary ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {volume.isPrimary ? 'H' : 'O'}
            </span>
            <TrafficVolumeInfoTooltip
              trafficVolumeId={volume.trafficVolumeId}
              className="inline-flex min-w-0"
              tooltipClassName="z-[12000]"
            >
              <span className="max-w-[120px] truncate font-medium text-sky-100">
                {volume.label}
              </span>
            </TrafficVolumeInfoTooltip>
            {volume.windowLabel && (
              <span className="shrink-0 font-mono text-white/45">{volume.windowLabel}</span>
            )}
          </span>
        </span>
      ))}
    </div>
  );
}

type FlowGroupMiniMapTooltipProps = {
  flightIds: string[];
  className?: string;
  children?: React.ReactNode;
};

function FlowGroupMiniMapTooltip({
  flightIds,
  className,
}: FlowGroupMiniMapTooltipProps) {
  const normalizedFlightIds = useMemo(() => {
    const seen = new Set<string>();
    const sanitized: string[] = [];
    for (const raw of flightIds ?? []) {
      const value = String(raw ?? '').trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      sanitized.push(value);
    }
    return sanitized;
  }, [flightIds]);

  const canShow = normalizedFlightIds.length > 0;
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = useCallback(() => {
    if (!canShow) return;
    setIsExpanded(prev => !prev);
  }, [canShow]);

  if (!canShow) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-left hover:border-white/20 hover:bg-white/[0.12] transition-all"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
            <ChevronDown className="w-4 h-4 text-white/60" />
          </div>
          <span className="text-xs font-medium text-white/70">
            {isExpanded ? 'Hide' : 'Show'} Flow Preview
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-3 rounded-xl border border-white/15 bg-slate-950/95 p-3 text-white/85 shadow-[0_24px_48px_-24px_rgba(14,165,233,0.65)] backdrop-blur-xl">
          <div className="text-[10px] font-semibold uppercase text-white/50 mb-2">
            Flow preview
          </div>
          <div className="h-[200px] w-full overflow-hidden rounded-lg border border-white/10 bg-slate-950/80">
            <FlightPathsMiniMap flightIds={normalizedFlightIds} className="h-full w-full" />
          </div>
        </div>
      )}
    </div>
  );
}

interface ViewRange {
  viewFrom: string;
  viewTo: string;
}

interface PinnedTvSummary {
  tv: string;
  peakPost: number | null;
  peakPre: number | null;
  peakCap: number | null;
  exceedance: number | null;
}

type ViewMode = 'per_episode' | 'whole_plan' | 'unselected';

const EMPTY_OCC: Record<string, number[]> = {};

const FLOW_ID_KEYS = [
  'flow_ids',
  'flowIds',
  'flows',
  'delayed_flow_ids',
  'delayedFlowIds',
  'regulated_flow_ids',
  'regulatedFlowIds',
  'trajectory_ids',
  'trajectoryIds',
  'regulated_flows',
  'regulatedFlows',
] as const;

const FLIGHT_ID_KEYS = [
  'flight_ids',
  'flightIds',
  'flights',
  'delayed_flight_ids',
  'delayedFlightIds',
  'targeted_flight_ids',
  'targetedFlightIds',
  'affected_flight_ids',
  'affectedFlightIds',
  'delayedFlights',
] as const;

const FLOW_COUNT_KEYS = [
  'flow_count',
  'flowCount',
  'flows_count',
  'flowsCount',
  'num_flows',
  'total_flows',
  'flow_total',
  'regulated_flow_count',
] as const;

const FLIGHT_COUNT_KEYS = [
  'flight_count',
  'flightCount',
  'flights_count',
  'flightsCount',
  'num_flights',
  'delayed_flights',
  'affected_flights',
  'affectedFlightCount',
  'total_flights',
  'flight_total',
] as const;

const REG_BASE_RATE_KEYS = [
  'original_rate_per_hour',
  'originalRatePerHour',
  'baseline_rate',
  'baselineRate',
  'previous_rate',
  'prev_rate',
  'rate_before',
] as const;

const REG_ALLOWED_RATE_KEYS = [
  'allowed_rate_per_hour',
  'allowedRatePerHour',
  'new_rate',
  'newRate',
  'updated_rate',
  'rate_after',
  'rate',
] as const;

function formatImprovement(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  const formatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  });
  return `+${formatter.format(value)}`;
}

function formatTrajectoryLength(length: number | null | undefined): string {
  if (length === null || length === undefined || Number.isNaN(length)) {
    return 'Unknown length';
  }
  if (length === 1) {
    return '1 step';
  }
  return `${length} steps`;
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  if (Math.abs(value) >= 100) {
    return Math.round(value).toString();
  }
  const rounded = Number(value.toFixed(1));
  return rounded.toString();
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  if (Math.abs(value) >= 100) {
    return Math.round(value).toString();
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(1).replace(/\.0$/, '');
  }
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function pickMetric(
  sources: Array<Record<string, unknown> | undefined | null>,
  keys: readonly string[],
): number | null {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const raw = source[key];
        const value = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw);
        if (Number.isFinite(value)) {
          return value;
        }
      }
    }
  }
  return null;
}

function pickString(values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function pickNumber(values: Array<unknown>): number | null {
  for (const value of values) {
    const numeric =
      typeof value === 'string'
        ? Number.parseFloat(value)
        : typeof value === 'number'
          ? value
          : null;
    if (numeric !== null && Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function asStringId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function extractIdsFromValue(value: unknown): string[] {
  const ids: string[] = [];
  if (!value) return ids;

  if (Array.isArray(value)) {
    for (const item of value) {
      const id = asStringId(item);
      if (id) ids.push(id);
    }
    return ids;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return ids;
    if (trimmed.includes(',')) {
      for (const part of trimmed.split(',')) {
        const id = asStringId(part);
        if (id) ids.push(id);
      }
      return ids;
    }
    const single = asStringId(trimmed);
    if (single) ids.push(single);
    return ids;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.ids)) {
      return extractIdsFromValue(obj.ids);
    }
    for (const nested of Object.values(obj)) {
      const nestedIds = extractIdsFromValue(nested);
      for (const id of nestedIds) {
        ids.push(id);
      }
    }
    return ids;
  }

  return ids;
}

function collectIdsFromReg(
  reg: AgentSolutionRegulation,
  keys: readonly string[],
): string[] {
  const ids: string[] = [];
  for (const key of keys) {
    const value = reg[key as keyof AgentSolutionRegulation];
    if (value === undefined) continue;
    const extracted = extractIdsFromValue(value);
    for (const id of extracted) {
      ids.push(id);
    }
  }
  return ids;
}

function extractNumeric(
  reg: AgentSolutionRegulation,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(reg, key)) continue;
    const raw = reg[key as keyof AgentSolutionRegulation];
    const value = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function getStepNumber(step?: AgentSolutionStep | null): number | null {
  if (!step) return null;
  const raw =
    step.step_number ??
    (step as Record<string, unknown>).stepNumber ??
    (step.metadata && (step.metadata.step_number as number));
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function getStepControlVolume(step?: AgentSolutionStep | null): string {
  if (!step) return '';
  return (
    pickString([
      step.control_volume,
      step.controlled_volume,
      (step as Record<string, unknown>).controlVolume,
      (step as Record<string, unknown>).controlledVolume,
    ]) ?? ''
  );
}

function getRegControlVolume(reg?: AgentSolutionRegulation | null): string {
  if (!reg) return '';
  return (
    pickString([
      reg.control_volume,
      reg.controlled_volume,
      (reg as Record<string, unknown>).traffic_volume,
      (reg as Record<string, unknown>).trafficVolume,
      (reg as Record<string, unknown>).cv,
    ]) ?? ''
  );
}

function normalizeControlVolume(value: string): string {
  return value.trim().toLowerCase();
}

function getStepTimeWindow(step?: AgentSolutionStep | null): string {
  if (!step) return '';
  return (
    pickString([
      step.time_window,
      step.timeWindow,
      (step.metadata && (step.metadata.time_window as string)) ?? null,
    ]) ?? ''
  );
}

function getRegTimeWindow(reg?: AgentSolutionRegulation | null): string {
  if (!reg) return '';
  return (
    pickString([
      reg.time_window,
      reg.timeWindow,
      (reg as Record<string, unknown>).window,
      (reg as Record<string, unknown>).time_window,
    ]) ?? ''
  );
}

function normalizeTimeWindow(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

function getStepRegulations(
  step?: AgentSolutionStep | null,
): AgentSolutionRegulation[] {
  if (!step) return [];

  const sources: unknown[] = [
    (step as Record<string, unknown>).regulations,
    (step as Record<string, unknown>).flows,
    step.metadata && (step.metadata as Record<string, unknown>).regulations,
  ];

  const result: AgentSolutionRegulation[] = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (entry && typeof entry === 'object') {
        result.push(entry as AgentSolutionRegulation);
      }
    }
  }
  return result;
}

function getRegStepNumber(reg?: AgentSolutionRegulation | null): number | null {
  if (!reg) return null;

  const metadata = (reg as Record<string, unknown>).metadata;
  const candidates: unknown[] = [
    reg.step_number,
    reg.stepNumber,
    (reg as Record<string, unknown>).step,
    (reg as Record<string, unknown>).step_index,
    (reg as Record<string, unknown>).stepIndex,
  ];

  if (metadata && typeof metadata === 'object') {
    candidates.push(
      (metadata as Record<string, unknown>).step_number,
      (metadata as Record<string, unknown>).stepNumber,
      (metadata as Record<string, unknown>).step,
    );
  }

  const picked = pickNumber(candidates);
  if (picked === null) return null;
  const integer = Math.trunc(picked);
  return Number.isFinite(integer) ? integer : null;
}

interface SolutionWithTrajectory {
  trajectory?: AgentSolutionStep[];
}

function getSolutionSteps(solution: AgentSolutionBest | null): AgentSolutionStep[] {
  if (!solution) return [];
  const trajectory = (solution as SolutionWithTrajectory | null)?.trajectory;
  const rawSteps = Array.isArray(solution.steps)
    ? solution.steps
    : Array.isArray(trajectory)
      ? trajectory
      : [];

  return rawSteps.map((step, index) => {
    if (!step || typeof step !== 'object') {
      return { step_number: index + 1 } as AgentSolutionStep;
    }
    const existingNumber = getStepNumber(step as AgentSolutionStep);
    if (existingNumber !== null) {
      return step as AgentSolutionStep;
    }
    return { ...(step as AgentSolutionStep), step_number: index + 1 };
  });
}

function computeStepAggregates(
  solution: AgentSolutionBest | null,
): Map<number, StepAggregate> {
  const map = new Map<number, StepAggregate>();
  if (!solution) return map;

  const steps = getSolutionSteps(solution);
  const topLevelRegulations = Array.isArray(solution.regulations)
    ? solution.regulations.filter(
      (entry): entry is AgentSolutionRegulation =>
        Boolean(entry) && typeof entry === 'object',
    )
    : [];

  const regsByStep = new Map<number, AgentSolutionRegulation[]>();
  for (const step of steps) {
    const stepNumber = getStepNumber(step);
    if (stepNumber === null) continue;
    const stepRegs = getStepRegulations(step);
    if (!stepRegs.length) continue;
    const existing = regsByStep.get(stepNumber);
    if (existing) {
      existing.push(...stepRegs);
    } else {
      regsByStep.set(stepNumber, [...stepRegs]);
    }
  }

  for (const reg of topLevelRegulations) {
    const stepNumber = getRegStepNumber(reg);
    if (stepNumber === null) continue;
    const existing = regsByStep.get(stepNumber);
    if (existing) {
      existing.push(reg);
    } else {
      regsByStep.set(stepNumber, [reg]);
    }
  }

  const allRegulations: AgentSolutionRegulation[] = [];
  const seen = new Set<AgentSolutionRegulation>();
  for (const regs of regsByStep.values()) {
    for (const reg of regs) {
      if (seen.has(reg)) continue;
      seen.add(reg);
      allRegulations.push(reg);
    }
  }
  for (const reg of topLevelRegulations) {
    if (seen.has(reg)) continue;
    seen.add(reg);
    allRegulations.push(reg);
  }

  for (const step of steps) {
    const stepNumber = getStepNumber(step);
    if (stepNumber === null) continue;

    let matches = regsByStep.get(stepNumber) ?? [];

    if (matches.length === 0) {
      const stepCv = normalizeControlVolume(getStepControlVolume(step));
      const stepWindow = normalizeTimeWindow(getStepTimeWindow(step));

      matches = allRegulations.filter((reg) => {
        const regCv = normalizeControlVolume(getRegControlVolume(reg));
        const regWindow = normalizeTimeWindow(getRegTimeWindow(reg));
        const cvMatches = stepCv ? stepCv === regCv : true;
        const windowMatches = stepWindow ? stepWindow === regWindow : true;
        return cvMatches && windowMatches;
      });
    }

    const flowIdsSet = new Set<string>();
    const flightIdsSet = new Set<string>();
    let flowFallback = 0;
    let flightFallback = 0;

    for (const reg of matches) {
      const flowIds = collectIdsFromReg(reg, FLOW_ID_KEYS);
      for (const id of flowIds) flowIdsSet.add(id);

      const flightIds = collectIdsFromReg(reg, FLIGHT_ID_KEYS);
      for (const id of flightIds) flightIdsSet.add(id);

      const flowCountCandidate = extractNumeric(reg, FLOW_COUNT_KEYS);
      if (flowCountCandidate !== null) flowFallback += flowCountCandidate;

      const flightCountCandidate = extractNumeric(reg, FLIGHT_COUNT_KEYS);
      if (flightCountCandidate !== null) flightFallback += flightCountCandidate;
    }

    const regulationCount = matches.length ? new Set(matches).size : 0;
    const flowCount =
      flowIdsSet.size > 0
        ? flowIdsSet.size
        : flowFallback > 0
          ? flowFallback
          : regulationCount;
    const flightCount =
      flightIdsSet.size > 0 ? flightIdsSet.size : flightFallback > 0 ? flightFallback : 0;

    map.set(stepNumber, {
      flowCount,
      flightCount,
      flowIds: Array.from(flowIdsSet),
      flightIds: Array.from(flightIdsSet),
    });
  }

  return map;
}

function getRegFlowIdString(reg: AgentSolutionRegulation | null | undefined): string | null {
  if (!reg) return null;
  const raw = (reg as any)?.flow_id ?? (reg as any)?.flowId ?? (reg as any)?.id ?? (reg as any)?.flow ?? null;
  const out = asStringId(raw);
  return out;
}

function normalizeRegulationArray(source: unknown): AgentSolutionRegulation[] {
  if (!Array.isArray(source)) return [];
  return source.filter(
    (entry): entry is AgentSolutionRegulation =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

function getSolutionRegulations(solution: AgentSolutionBest | null): AgentSolutionRegulation[] {
  return normalizeRegulationArray(solution?.regulations);
}

function filterRegulationsForStep(
  regulations: AgentSolutionRegulation[],
  selectedStep: AgentSolutionStep | null,
): AgentSolutionRegulation[] {
  if (!selectedStep) return [];

  const stepNumber = getStepNumber(selectedStep);
  if (Number.isFinite(stepNumber)) {
    const explicitMatches = regulations.filter((reg) => {
      const regStepNumber = getRegStepNumber(reg);
      return Number.isFinite(regStepNumber) && regStepNumber === stepNumber;
    });
    if (explicitMatches.length > 0) return explicitMatches;
  }

  const stepCv = normalizeControlVolume(getStepControlVolume(selectedStep));
  const stepWindow = normalizeTimeWindow(getStepTimeWindow(selectedStep));
  return regulations.filter((reg) => {
    const regCv = normalizeControlVolume(getRegControlVolume(reg));
    const regWindow = normalizeTimeWindow(getRegTimeWindow(reg));
    const cvMatches = stepCv ? stepCv === regCv : true;
    const windowMatches = stepWindow ? stepWindow === regWindow : true;
    return cvMatches && windowMatches;
  });
}

function getStepDetailRegulations(
  solution: AgentSolutionBest | null,
  selectedStep: AgentSolutionStep | null,
  details: AgentSolDetailsResponse | null,
): AgentSolutionRegulation[] {
  const detailRegulations = normalizeRegulationArray(details?.selected_step_regulations);
  if (detailRegulations.length > 0) return detailRegulations;
  return filterRegulationsForStep(getSolutionRegulations(solution), selectedStep);
}

function getViewRegulations(
  viewMode: ViewMode,
  solution: AgentSolutionBest | null,
  selectedStep: AgentSolutionStep | null,
  details: AgentSolDetailsResponse | null,
): AgentSolutionRegulation[] {
  if (viewMode === 'whole_plan') {
    const detailRegulations = normalizeRegulationArray(details?.regulations);
    return detailRegulations.length > 0 ? detailRegulations : getSolutionRegulations(solution);
  }
  if (viewMode === 'per_episode') {
    return getStepDetailRegulations(solution, selectedStep, details);
  }
  return [];
}

function getDetailTimeBinMinutes(details: AgentSolDetailsResponse | null): number | null {
  const raw = details?.pre_post?.time_bin_minutes ?? details?.metadata?.time_bin_minutes;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getRegExtractorMetadata(reg: AgentSolutionRegulation | null | undefined): Partial<VpfFlowMetadata> | null {
  const metadata = reg?.extractor_metadata ?? (reg as Record<string, unknown> | null | undefined)?.extractor_metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return metadata as Partial<VpfFlowMetadata>;
}

function buildRegFlowMetadata(
  reg: AgentSolutionRegulation,
  timeBinMinutes: number | null,
): FlowGroupMetadata | null {
  const metadata = getRegExtractorMetadata(reg);
  if (!metadata) return null;
  return buildFlowGroupMetadata(metadata, null, { timeBinMinutes });
}

function getRegDefiningTrafficVolumeIds(reg: AgentSolutionRegulation): string[] {
  const metadata = getRegExtractorMetadata(reg);
  if (!metadata) return [];
  const flowMetadata = buildFlowGroupMetadata(metadata);
  return (flowMetadata.definingVolumes ?? []).map((volume) => volume.trafficVolumeId);
}

function buildFlowDefinitionRows(
  regulations: AgentSolutionRegulation[],
  timeBinMinutes: number | null,
): FlowDefinitionRow[] {
  type FlowDefinitionBucket = FlowDefinitionRow & {
    order: number;
    flightIds: Set<string>;
    fallbackFlightCount: number | null;
  };

  const buckets = new Map<string, FlowDefinitionBucket>();
  let order = 0;

  for (const reg of regulations) {
    const stepNumber = getRegStepNumber(reg);
    const flowId = getRegFlowIdString(reg) ?? undefined;
    const controlVolume = getRegControlVolume(reg) || undefined;
    const timeWindow = getRegTimeWindow(reg) || undefined;
    const metadata = buildRegFlowMetadata(reg, timeBinMinutes);
    const baselineRate = extractNumeric(reg, REG_BASE_RATE_KEYS);
    const allowedRate = extractNumeric(reg, REG_ALLOWED_RATE_KEYS);
    const flightIds = Array.from(
      new Set(
        collectIdsFromReg(reg, FLIGHT_ID_KEYS)
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    );
    const fallbackFlightCount = extractNumeric(reg, FLIGHT_COUNT_KEYS);
    const hasStableIdentity =
      stepNumber !== null || Boolean(flowId) || Boolean(controlVolume) || Boolean(timeWindow);
    const key = hasStableIdentity
      ? [
          stepNumber ?? '',
          flowId ?? '',
          controlVolume ? normalizeControlVolume(controlVolume) : '',
          timeWindow ? normalizeTimeWindow(timeWindow) : '',
        ].join('||')
      : `row-${order}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        stepNumber,
        flowId,
        controlVolume,
        timeWindow,
        baselineRate,
        allowedRate,
        flightCount: null,
        metadata,
        order: order++,
        flightIds: new Set<string>(),
        fallbackFlightCount,
      };
      buckets.set(key, bucket);
    } else {
      if (bucket.stepNumber === null && stepNumber !== null) bucket.stepNumber = stepNumber;
      if (!bucket.flowId && flowId) bucket.flowId = flowId;
      if (!bucket.controlVolume && controlVolume) bucket.controlVolume = controlVolume;
      if (!bucket.timeWindow && timeWindow) bucket.timeWindow = timeWindow;
      if (bucket.baselineRate === null && baselineRate !== null) bucket.baselineRate = baselineRate;
      if (bucket.allowedRate === null && allowedRate !== null) bucket.allowedRate = allowedRate;
      if (
        (!bucket.metadata?.definingVolumes?.length && metadata?.definingVolumes?.length) ||
        (!bucket.metadata && metadata)
      ) {
        bucket.metadata = metadata;
      }
      if (bucket.fallbackFlightCount === null && fallbackFlightCount !== null) {
        bucket.fallbackFlightCount = fallbackFlightCount;
      }
    }

    for (const flightId of flightIds) {
      bucket.flightIds.add(flightId);
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => {
      const aStep = a.stepNumber ?? Number.POSITIVE_INFINITY;
      const bStep = b.stepNumber ?? Number.POSITIVE_INFINITY;
      if (aStep !== bStep) return aStep - bStep;
      return a.order - b.order;
    })
    .map((bucket) => ({
      key: bucket.key,
      stepNumber: bucket.stepNumber,
      flowId: bucket.flowId,
      controlVolume: bucket.controlVolume,
      timeWindow: bucket.timeWindow,
      baselineRate: bucket.baselineRate,
      allowedRate: bucket.allowedRate,
      flightCount: bucket.flightIds.size > 0 ? bucket.flightIds.size : bucket.fallbackFlightCount,
      metadata: bucket.metadata,
    }));
}

function buildFlowGroupsForStep(
  solution: AgentSolutionBest | null,
  selectedStep: AgentSolutionStep | null,
  details: AgentSolDetailsResponse | null,
  flightsById: Map<string, Trajectory>,
): FlowGroup[] {
  if (!solution || !selectedStep) return [];
  const regs = getStepDetailRegulations(solution, selectedStep, details);

  if (regs.length === 0) return [];
  const timeBinMinutes = getDetailTimeBinMinutes(details);

  const detailsRows: Map<string, FlowGroupRow> = new Map();
  if (details?.step_delays_by_flight) {
    for (const [fid, payload] of Object.entries(details.step_delays_by_flight)) {
      const flightId = String(fid);
      const info =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as AgentSolutionFlightDelay)
          : undefined;
      const sim = flightsById.get(flightId);
      const callsign =
        pickString([
          info?.callsign,
          info?.call_sign,
          sim?.callSign,
          sim?.flightId,
          flightId,
        ]) ?? flightId;
      const origin = pickString([info?.origin, sim?.origin]) ?? '—';
      const destination = pickString([info?.destination, sim?.destination]) ?? '—';
      const delayMinutes =
        pickNumber([
          info?.delay_minutes,
          info?.delayMinutes,
          info?.delay_min,
          info?.delay,
          typeof payload === 'number' || typeof payload === 'string' ? payload : null,
        ]) ?? 0;
      const targeted = Boolean(
        info?.targeted ?? info?.is_targeted ?? info?.selected ?? info?.is_selected ?? false,
      );
      detailsRows.set(flightId, {
        flightId,
        callsign,
        origin,
        destination,
        delayMinutes,
        targeted,
      });
    }
  }

  type FlowBucket = {
    controlVolume?: string;
    timeWindow?: string;
    flowId?: string;
    baselineRate: number | null;
    allowedRate: number | null;
    metadata: FlowGroupMetadata | null;
    flightIds: Set<string>;
  };

  const buckets = new Map<string, FlowBucket>();
  const bucketOrder: string[] = [];

  for (const reg of regs) {
    const controlVolumeCandidate = getRegControlVolume(reg);
    const timeWindowCandidate = getRegTimeWindow(reg);
    const controlVolume =
      controlVolumeCandidate || getStepControlVolume(selectedStep) || '';
    const timeWindow =
      timeWindowCandidate || getStepTimeWindow(selectedStep) || '';
    const rawFlowId = getRegFlowIdString(reg);
    const flowId = rawFlowId ? asStringId(rawFlowId) ?? undefined : undefined;

    const ids = Array.from(
      new Set(
        collectIdsFromReg(reg, FLIGHT_ID_KEYS)
          .map((value) => String(value).trim())
          .filter((value) => value.length > 0),
      ),
    );
    if (ids.length === 0) continue;

    const dedupeKey = [
      (flowId ?? '').toLowerCase(),
      controlVolume ? normalizeControlVolume(controlVolume) : '',
      timeWindow ? normalizeTimeWindow(timeWindow) : '',
    ].join('||');

    let bucket = buckets.get(dedupeKey);
    if (!bucket) {
      bucket = {
        controlVolume: controlVolume || undefined,
        timeWindow: timeWindow || undefined,
        flowId,
        baselineRate: extractNumeric(reg, REG_BASE_RATE_KEYS),
        allowedRate: extractNumeric(reg, REG_ALLOWED_RATE_KEYS),
        metadata: buildRegFlowMetadata(reg, timeBinMinutes),
        flightIds: new Set<string>(),
      };
      buckets.set(dedupeKey, bucket);
      bucketOrder.push(dedupeKey);
    } else {
      if (!bucket.controlVolume && controlVolume) {
        bucket.controlVolume = controlVolume;
      }
      if (!bucket.timeWindow && timeWindow) {
        bucket.timeWindow = timeWindow;
      }
      if (!bucket.flowId && flowId) {
        bucket.flowId = flowId;
      }
      if (bucket.baselineRate === null) {
        const candidate = extractNumeric(reg, REG_BASE_RATE_KEYS);
        if (candidate !== null) bucket.baselineRate = candidate;
      }
      if (bucket.allowedRate === null) {
        const candidate = extractNumeric(reg, REG_ALLOWED_RATE_KEYS);
        if (candidate !== null) bucket.allowedRate = candidate;
      }
      if (!bucket.metadata?.definingVolumes?.length) {
        const candidate = buildRegFlowMetadata(reg, timeBinMinutes);
        if (candidate?.definingVolumes?.length) bucket.metadata = candidate;
      }
    }

    for (const id of ids) {
      bucket.flightIds.add(id);
    }
  }

  const used = new Set<string>();
  const groups: FlowGroup[] = [];
  let autoIndex = 1;

  for (const bucketKey of bucketOrder) {
    const bucket = buckets.get(bucketKey);
    if (!bucket) continue;

    const controlVolume =
      bucket.controlVolume || getStepControlVolume(selectedStep) || undefined;
    const timeWindow =
      bucket.timeWindow || getStepTimeWindow(selectedStep) || undefined;

    const rows: FlowGroupRow[] = [];
    for (const id of bucket.flightIds) {
      if (used.has(id)) {
        continue;
      }
      const fromDetails = detailsRows.get(id);
      if (fromDetails) {
        rows.push(fromDetails);
        used.add(id);
        continue;
      }
      const sim = flightsById.get(id);
      const callsign = pickString([sim?.callSign, sim?.flightId, id]) ?? id;
      rows.push({
        flightId: id,
        callsign,
        origin: sim?.origin ?? '—',
        destination: sim?.destination ?? '—',
        delayMinutes: 0,
        targeted: false,
      });
      used.add(id);
    }

    if (rows.length === 0) {
      continue;
    }

    rows.sort((a, b) => {
      if (a.targeted !== b.targeted) return a.targeted ? -1 : 1;
      if (Math.abs(b.delayMinutes - a.delayMinutes) > 0.001) {
        return b.delayMinutes - a.delayMinutes;
      }
      return a.callsign.localeCompare(b.callsign);
    });

    const assignedFlowId = bucket.flowId ?? `flow-${autoIndex++}`;
    const label = `${controlVolume || 'Flow'}${timeWindow ? ` · ${timeWindow}` : ''}${assignedFlowId ? ` · #${assignedFlowId}` : ''
      }`;

    groups.push({
      key: String(assignedFlowId),
      label,
      controlVolume,
      timeWindow,
      flowId: asStringId(assignedFlowId) ?? undefined,
      baselineRate: bucket.baselineRate,
      allowedRate: bucket.allowedRate,
      metadata: bucket.metadata,
      flightIds: rows.map((r) => r.flightId),
      rows,
    });
  }

  // If there are flights in details not covered by any flow, add an "Other" bucket
  const otherRows: FlowGroupRow[] = [];
  for (const row of detailsRows.values()) {
    if (!used.has(row.flightId)) otherRows.push(row);
  }
  if (otherRows.length > 0) {
    otherRows.sort((a, b) => {
      if (a.targeted !== b.targeted) return a.targeted ? -1 : 1;
      if (Math.abs(b.delayMinutes - a.delayMinutes) > 0.001) {
        return b.delayMinutes - a.delayMinutes;
      }
      return a.callsign.localeCompare(b.callsign);
    });
    groups.push({
      key: 'other',
      label: 'Other Flights',
      controlVolume: getStepControlVolume(selectedStep) || undefined,
      timeWindow: getStepTimeWindow(selectedStep) || undefined,
      flightIds: otherRows.map((r) => r.flightId),
      rows: otherRows,
    });
  }

  return groups;
}

function computeSolutionMetrics(
  solution: AgentSolutionBest | null,
  details: AgentSolDetailsResponse | null,
): { flows: number | null; flights: number | null; delayMinutes: number | null } {
  const sources: Array<Record<string, unknown> | undefined | null> = [
    solution?.metrics,
    details?.metadata,
    solution?.metadata,
  ];
  const flows = pickMetric(sources, FLOW_COUNT_KEYS);
  const flights = pickMetric(sources, FLIGHT_COUNT_KEYS);
  const delayMinutes = pickMetric(
    sources,
    ['total_delay_minutes', 'delay_minutes', 'delay_min', 'total_delay', 'total_delay_min'],
  );
  return { flows, flights, delayMinutes };
}

function maxSeriesValue(series: unknown): number | null {
  if (!Array.isArray(series)) return null;
  let max: number | null = null;
  for (const entry of series) {
    const value = typeof entry === 'number' ? entry : Number(entry);
    if (!Number.isFinite(value)) continue;
    if (max === null || value > max) {
      max = value;
    }
  }
  return max;
}

function extractTimeLabel(value: unknown, takeEnd: boolean): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.includes('-')) {
    const parts = trimmed.split('-').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return takeEnd ? parts[parts.length - 1] : parts[0];
    }
  }

  if (/^\d{2}:\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 5);
  }

  return trimmed;
}

function deriveViewRange(details: AgentSolDetailsResponse | null): ViewRange {
  const fallback: ViewRange = { viewFrom: '00:00', viewTo: '24:00' };
  if (!details) return fallback;

  const firstSegment = details.hotspot_segments?.find(
    (segment) =>
      segment &&
      (segment.start_label ||
        (segment as Record<string, unknown>).startLabel ||
        (segment as Record<string, unknown>).start),
  );

  if (firstSegment) {
    const start = pickString([
      firstSegment.start_label,
      firstSegment.startLabel,
      (firstSegment as Record<string, unknown>).start,
    ]);
    const end = pickString([
      firstSegment.end_label,
      firstSegment.endLabel,
      (firstSegment as Record<string, unknown>).end,
    ]);
    if (start && end) {
      return { viewFrom: start, viewTo: end };
    }
  }

  const prePost = details.pre_post;
  const labels =
    (prePost?.timebins && Array.isArray(prePost.timebins.labels)
      ? prePost.timebins.labels
      : undefined) ||
    (Array.isArray(prePost?.labels) ? prePost?.labels : undefined);

  if (labels && labels.length > 0) {
    const start = extractTimeLabel(labels[0], false);
    const end = extractTimeLabel(labels[labels.length - 1], true);
    if (start && end) {
      return { viewFrom: start, viewTo: end };
    }
  }

  return fallback;
}

function buildFlightRows(
  details: AgentSolDetailsResponse | null,
  flightsById: Map<string, Trajectory>,
): FlightRowData[] {
  if (!details?.step_delays_by_flight) return [];

  const rows: FlightRowData[] = [];
  for (const [flightIdRaw, payload] of Object.entries(details.step_delays_by_flight)) {
    const flightId = String(flightIdRaw).trim();
    if (!flightId) continue;

    const info =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as AgentSolutionFlightDelay)
        : undefined;
    const sim = flightsById.get(flightId);

    const callsign =
      pickString([
        info?.callsign,
        info?.call_sign,
        sim?.callSign,
        sim?.flightId,
        flightId,
      ]) ?? flightId;

    const origin = pickString([info?.origin, sim?.origin]) ?? '—';
    const destination = pickString([info?.destination, sim?.destination]) ?? '—';
    const delayMinutes =
      pickNumber([
        info?.delay_minutes,
        info?.delayMinutes,
        info?.delay_min,
        info?.delay,
        typeof payload === 'number' || typeof payload === 'string' ? payload : null,
      ]) ?? 0;
    const targeted = Boolean(
      info?.targeted ?? info?.is_targeted ?? info?.selected ?? info?.is_selected ?? false,
    );

    rows.push({
      flightId,
      callsign,
      origin,
      destination,
      delayMinutes,
      targeted,
    });
  }

  rows.sort((a, b) => {
    if (a.targeted !== b.targeted) return a.targeted ? -1 : 1;
    if (Math.abs(b.delayMinutes - a.delayMinutes) > 0.001) {
      return b.delayMinutes - a.delayMinutes;
    }
    return a.callsign.localeCompare(b.callsign);
  });

  return rows;
}

function pickOccupancySeries(
  series: OccupancySeriesByTv | undefined,
  tvIds: string[],
): OccupancySeriesByTv {
  if (!series) return {};
  const result: OccupancySeriesByTv = {};
  for (const tv of tvIds) {
    if (Object.prototype.hasOwnProperty.call(series, tv)) {
      result[tv] = series[tv];
    }
  }
  return result;
}

const historicalTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const { label, value } = entry;
  return (
    <div className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-white shadow-md backdrop-blur">
      <div className="font-medium text-white/90">{label}</div>
      <div className="text-emerald-300">{formatImprovement(value)}</div>
    </div>
  );
};

export default function AgentResultSummaryComponent({
  className = '',
  endpoint = '/api/agent_sol_summary',
  initialRun,
}: AgentResultSummaryComponentProps) {
  const [runListData, setRunListData] = useState<AgentSolListResponse | null>(null);
  const [rzSummaryData, setRzSummaryData] = useState<AgentSolSummaryResponse | null>(null);
  const [selectedRunRef, setSelectedRunRef] = useState<AgentRunRef | null>(
    () => initialRun ?? null,
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isPendingView, startViewTransition] = useTransition();
  const commitTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [selectedSolutionRank, setSelectedSolutionRank] = useState<number>(1);
  const [selectedStepNumber, setSelectedStepNumber] = useState<number>(1);
  const [viewMode, setViewMode] = useState<ViewMode>('unselected');
  const [bestData, setBestData] = useState<AgentSolBestResponse | null>(null);
  const [bestLoading, setBestLoading] = useState<boolean>(false);
  const [bestError, setBestError] = useState<string | null>(null);
  const [detailsData, setDetailsData] = useState<AgentSolDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState<boolean>(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [perAccAttribMode, setPerAccAttribMode] = useState<RegulationPlanPerAccAttribMode>('dwelling_spread');
  const [selectedFlightIds, setSelectedFlightIds] = useState<string[]>([]);
  const [viewFrom, setViewFrom] = useState<string>('00:00');
  const [viewTo, setViewTo] = useState<string>('23:59');
  const [occSortMode, setOccSortMode] = useState<OccupancyPrePostSortMode>('total');
  const unpinGlobalTrafficVolume = useGlobalTVBasketStore((state) => state.unpinTv);
  const [isFlightsPaneOpen, setIsFlightsPaneOpen] = useState(false);

  const flights = useSimStore((state) => state.flights);

  useEffect(() => {
    if (!initialRun) return;
    setSelectedRunRef((current) =>
      current?.runKey === initialRun.runKey ? current : initialRun,
    );
  }, [initialRun]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function fetchRunList() {
      try {
        setLoading(true);
        setError(null);
        const response = await authFetch('/api/agent_sol_ls', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as AgentSolListResponse;
        if (cancelled) return;
        setRunListData(payload);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load runs');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchRunList();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function fetchRzSummary() {
      try {
        const response = await authFetch(endpoint, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as AgentSolSummaryResponse;
        if (cancelled) return;
        setRzSummaryData(payload);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        console.error('Failed to load RZ summary enrichment:', err);
        setRzSummaryData(null);
      }
    }

    fetchRzSummary();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [endpoint]);

  const runEntries = useMemo<AgentRunBrowserEntry[]>(() => {
    const rzById = new Map(
      (rzSummaryData?.runs ?? []).map((run) => [run.run_id, run]),
    );
    const entries: AgentRunBrowserEntry[] = [];

    for (const run of runListData?.runs ?? []) {
      const ref = toAgentRunRef(run);
      if (!ref) continue;
      const rzSummary = ref.methodology === 'rz' ? rzById.get(ref.runId) : undefined;
      entries.push({
        ...run,
        ref,
        best_total_improvement:
          run.best_total_improvement ?? rzSummary?.best_total_improvement ?? null,
        solutions: rzSummary?.solutions ?? [],
        metadata: rzSummary?.metadata,
      });
    }

    return entries;
  }, [runListData?.runs, rzSummaryData?.runs]);

  useEffect(() => {
    if (!runEntries.length) return;
    setSelectedRunRef((current) => {
      const hasCurrent =
        current && runEntries.some((run) => run.ref.runKey === current.runKey);
      if (hasCurrent) {
        return current;
      }
      const preferred =
        initialRun &&
        runEntries.some((run) => run.ref.runKey === initialRun.runKey)
          ? initialRun
          : runEntries[0]?.ref ?? null;
      return preferred ?? null;
    });
  }, [initialRun, runEntries]);

  const selectedRun = useMemo(() => {
    if (!selectedRunRef || !runEntries.length) return null;
    return runEntries.find((run) => run.ref.runKey === selectedRunRef.runKey) ?? null;
  }, [runEntries, selectedRunRef]);

  const selectedRzRun = useMemo(
    () => (selectedRun?.ref.methodology === 'rz' ? selectedRun : null),
    [selectedRun],
  );

  useEffect(() => {
    if (!selectedRzRun) {
      setBestData(null);
      setBestError(null);
      setBestLoading(false);
      setDetailsData(null);
      setDetailsError(null);
      setDetailsLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setBestLoading(true);
    setBestError(null);
    setDetailsData(null);
    setDetailsError(null);

    (async () => {
      try {
        const params = new URLSearchParams({ run_id: selectedRzRun.run_id });
        const response = await authFetch(`/api/agent_sol_best?${params.toString()}`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || `Failed to fetch solution preview (${response.status})`);
        }

        const payload = (await response.json()) as AgentSolBestResponse;
        if (cancelled) return;
        setBestData(payload);
        setBestError(null);
        setSelectedSolutionRank((current) => {
          const available = Array.isArray(payload?.solutions)
            ? payload.solutions
            : [];
          if (available.some((solution) => solution.rank === current)) {
            return current;
          }
          return available[0]?.rank ?? 1;
        });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setBestError(
          err instanceof Error ? err.message : 'Failed to fetch solution preview',
        );
        setBestData(null);
        setSelectedSolutionRank(1);
        setSelectedStepNumber(1);
      } finally {
        if (!cancelled) setBestLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedRzRun]);

  const bestSolutions = useMemo(
    () => (Array.isArray(bestData?.solutions) ? bestData?.solutions : []),
    [bestData],
  );

  const selectedSolution = useMemo(() => {
    if (!bestSolutions.length) return null;
    return bestSolutions.find((solution) => solution.rank === selectedSolutionRank) ?? null;
  }, [bestSolutions, selectedSolutionRank]);

  const selectedSolutionSteps = useMemo(
    () => getSolutionSteps(selectedSolution),
    [selectedSolution],
  );

  useEffect(() => {
    if (!selectedSolution) {
      setSelectedStepNumber(1);
      return;
    }
    const availableSteps = selectedSolutionSteps;
    setSelectedStepNumber((current) => {
      const hasCurrent = availableSteps.some(
        (step) => getStepNumber(step) === current,
      );
      if (hasCurrent) return current;
      const fallback =
        availableSteps
          .map((step) => getStepNumber(step))
          .find((stepNumber) => stepNumber !== null) ?? 1;
      return fallback;
    });
  }, [selectedSolution, selectedSolutionSteps]);

  useEffect(() => {
    setSelectedFlightIds([]);
  }, [selectedRzRun?.run_id, selectedSolutionRank, selectedStepNumber, viewMode]);

  useEffect(() => {
    if (viewMode !== 'per_episode') {
      return;
    }
    if (!selectedRzRun || !selectedSolution) {
      setDetailsData(null);
      setDetailsError(null);
      setDetailsLoading(false);
      return;
    }

    const stepNumber = selectedStepNumber;
    if (!Number.isFinite(stepNumber)) return;
    const haveStep = selectedSolutionSteps.some((step) => getStepNumber(step) === stepNumber);
    if (!haveStep) return;

    let cancelled = false;
    const controller = new AbortController();
    setDetailsLoading(true);
    setDetailsError(null);

    (async () => {
      try {
        const params = new URLSearchParams({
          run_id: selectedRzRun.run_id,
          solution_rank: String(selectedSolutionRank),
          step_number: String(stepNumber),
          per_acc_attrib_mode: perAccAttribMode,
        });
        const response = await authFetch(`/api/agent_sol_details?${params.toString()}`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || `Failed to fetch step details (${response.status})`);
        }
        const payload = (await response.json()) as AgentSolDetailsResponse;
        if (cancelled) return;
        setDetailsData(payload);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setDetailsError(
          err instanceof Error ? err.message : 'Failed to fetch step details',
        );
        setDetailsData(null);
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    selectedRzRun,
    selectedSolution,
    selectedSolutionRank,
    selectedStepNumber,
    selectedSolutionSteps,
    perAccAttribMode,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode !== 'whole_plan') {
      return;
    }
    if (!selectedRzRun || !selectedSolution) {
      setDetailsData(null);
      setDetailsError(null);
      setDetailsLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setDetailsLoading(true);
    setDetailsError(null);
    (async () => {
      try {
        const params = new URLSearchParams({
          run_id: selectedRzRun.run_id,
          solution_rank: String(selectedSolutionRank),
          per_acc_attrib_mode: perAccAttribMode,
        });
        const response = await authFetch(
          `/api/agent_sol_details_wholeplan?${params.toString()}`,
          {
            method: 'GET',
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(
            text || `Failed to fetch whole-plan details (${response.status})`,
          );
        }
        const payload = (await response.json()) as AgentSolDetailsResponse;
        if (!cancelled) setDetailsData(payload);
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setDetailsError(
            err instanceof Error
              ? err.message
              : 'Failed to fetch whole-plan details',
          );
          setDetailsData(null);
        }
      } finally {
        if (!cancelled) {
          setDetailsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [viewMode, selectedRzRun, selectedSolution, selectedSolutionRank, perAccAttribMode]);

  const stepAggregates = useMemo(
    () => computeStepAggregates(selectedSolution),
    [selectedSolution],
  );

  const selectedStep = useMemo(() => {
    if (!selectedSolution) return null;
    return (
      selectedSolutionSteps.find((step) => getStepNumber(step) === selectedStepNumber) ?? null
    );
  }, [selectedSolution, selectedSolutionSteps, selectedStepNumber]);

  const selectedStepAggregate = useMemo(
    () => (Number.isFinite(selectedStepNumber) ? stepAggregates.get(selectedStepNumber) : undefined),
    [stepAggregates, selectedStepNumber],
  );

  const solutionMetrics = useMemo(
    () => computeSolutionMetrics(selectedSolution, detailsData),
    [selectedSolution, detailsData],
  );

  const detailsPerAccAttribModeRaw = detailsData?.per_acc_attrib?.mode;
  const detailsHasPerAccAttrib = Boolean(detailsData?.per_acc_attrib);
  useEffect(() => {
    if (!detailsHasPerAccAttrib) return;
    setPerAccAttribMode(normalizePerAccAttribMode(detailsPerAccAttribModeRaw));
  }, [detailsHasPerAccAttrib, detailsPerAccAttribModeRaw]);

  const lastUpdated = useMemo(
    () =>
      formatTimestamp(
        pickString([
          selectedSolution?.metadata?.last_updated,
          bestData?.metadata?.last_updated,
          (selectedSolution?.metadata as Record<string, unknown> | undefined)?.lastUpdated as string,
        ]) ?? undefined,
      ),
    [selectedSolution, bestData],
  );

  const flightsById = useMemo(() => {
    const map = new Map<string, Trajectory>();
    for (const flight of flights) {
      map.set(String(flight.flightId), flight);
    }
    return map;
  }, [flights]);

  const flightRows = useMemo(
    () => buildFlightRows(detailsData, flightsById),
    [detailsData, flightsById],
  );

  const flowGroups = useMemo(
    () => {
      if (viewMode === 'whole_plan' || viewMode === 'unselected') return [];
      return buildFlowGroupsForStep(selectedSolution, selectedStep, detailsData, flightsById);
    },
    [selectedSolution, selectedStep, detailsData, flightsById, viewMode],
  );

  const viewRegulations = useMemo(
    () => getViewRegulations(viewMode, selectedSolution, selectedStep, detailsData),
    [viewMode, selectedSolution, selectedStep, detailsData],
  );

  const flowDefinitionRows = useMemo(
    () => buildFlowDefinitionRows(viewRegulations, getDetailTimeBinMinutes(detailsData)),
    [viewRegulations, detailsData],
  );

  // Flow definitions for every step of the plan (not just the selected one), so the
  // per-episode step grid can render each step's defining volumes inline.
  const flowDefinitionsByStep = useMemo(() => {
    const map = new Map<number, FlowDefinitionRow[]>();
    if (viewMode !== 'per_episode' || !selectedSolution) return map;
    const rows = buildFlowDefinitionRows(
      getSolutionRegulations(selectedSolution),
      getDetailTimeBinMinutes(detailsData),
    );
    for (const row of rows) {
      if (row.stepNumber === null) continue;
      const list = map.get(row.stepNumber);
      if (list) list.push(row);
      else map.set(row.stepNumber, [row]);
    }
    return map;
  }, [viewMode, selectedSolution, detailsData]);

  const availableTrafficVolumes = useMemo(() => {
    const set = new Set<string>();
    const prePost = detailsData?.pre_post;
    if (prePost) {
      Object.keys(prePost.post_counts ?? {}).forEach((key) => set.add(String(key)));
      Object.keys(prePost.pre_counts ?? {}).forEach((key) => set.add(String(key)));
      Object.keys(prePost.capacity ?? {}).forEach((key) => set.add(String(key)));
      (prePost.tv_ids_order ?? []).forEach((key) => set.add(String(key)));
    }
    if (viewMode === 'per_episode') {
      for (const step of selectedSolutionSteps) {
        const cv = getStepControlVolume(step);
        if (cv) {
          set.add(cv);
        }
      }
      const regs = Array.isArray(selectedSolution?.regulations)
        ? selectedSolution.regulations
        : [];
      for (const reg of regs) {
        const cv = getRegControlVolume(reg);
        if (cv) {
          set.add(cv);
        }
      }
    }
    for (const reg of viewRegulations) {
      const cv = getRegControlVolume(reg);
      if (cv) {
        set.add(cv);
      }
      for (const tv of getRegDefiningTrafficVolumeIds(reg)) {
        set.add(tv);
      }
    }
    return Array.from(set)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }, [detailsData?.pre_post, selectedSolution?.regulations, selectedSolutionSteps, viewMode, viewRegulations]);

  const globalTvBasket = useGlobalTVBasket(availableTrafficVolumes);

  const handleUnpinTrafficVolume = useCallback((tv: string) => {
    unpinGlobalTrafficVolume(tv);
  }, [unpinGlobalTrafficVolume]);

  const preCounts = detailsData?.pre_post?.pre_counts ?? {};
  const postCounts = detailsData?.pre_post?.post_counts ?? {};
  const capacityCounts = detailsData?.pre_post?.capacity ?? {};

  // Filter out capacity values >998 so they don't affect y-axis scaling
  // Values >998 (like 9999 for unopened traffic volumes) are set to NaN
  // which will be treated as null in OccupancyPrePostPanel
  const filteredCapacityCounts = useMemo<Record<string, number[]> | undefined>(() => {
    if (!capacityCounts || Object.keys(capacityCounts).length === 0) return undefined;
    const filtered: Record<string, number[]> = {};
    Object.entries(capacityCounts).forEach(([tv, series]) => {
      if (Array.isArray(series)) {
        filtered[tv] = series.map((cap: number) => 
          Number.isFinite(cap) && cap > 998 ? NaN : cap
        );
      } else {
        filtered[tv] = series;
      }
    });
    return Object.keys(filtered).length > 0 ? filtered : undefined;
  }, [capacityCounts]);

  const pinnedSummaries = useMemo<PinnedTvSummary[]>(() => {
    if (!globalTvBasket.activePinnedIds.length) return [];
    const summaries: PinnedTvSummary[] = [];
    for (const tv of globalTvBasket.activePinnedIds) {
      const peakPost = maxSeriesValue(postCounts?.[tv]);
      const peakPre = maxSeriesValue(preCounts?.[tv]);
      const peakCap = maxSeriesValue(capacityCounts?.[tv]);
      if (peakPost === null && peakPre === null && peakCap === null) continue;
      const exceedance =
        peakPost !== null && peakCap !== null ? Math.max(0, peakPost - peakCap) : null;
      summaries.push({
        tv,
        peakPost,
        peakPre,
        peakCap,
        exceedance,
      });
    }
    return summaries;
  }, [globalTvBasket.activePinnedIds, postCounts, preCounts, capacityCounts]);

  const delayedFlightIds = useMemo(() => {
    const delayed = flightRows
      .filter((row) => row.delayMinutes > 0)
      .map((row) => row.flightId);
    if (delayed.length > 0) return delayed;
    return flightRows.map((row) => row.flightId);
  }, [flightRows]);

  const solutionTrafficVolumeIds = useMemo(() => {
    const set = new Set<string>();
    for (const step of selectedSolutionSteps) {
      const cv = getStepControlVolume(step);
      if (cv) {
        set.add(cv.trim());
      }
    }
    const regs = Array.isArray(selectedSolution?.regulations)
      ? selectedSolution.regulations
      : [];
    for (const reg of regs) {
      const cv = getRegControlVolume(reg);
      if (cv) {
        set.add(cv.trim());
      }
    }
    for (const reg of viewRegulations) {
      const cv = getRegControlVolume(reg);
      if (cv) {
        set.add(cv.trim());
      }
      for (const tv of getRegDefiningTrafficVolumeIds(reg)) {
        set.add(tv.trim());
      }
    }
    return Array.from(set)
      .filter((id) => id.length > 0)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }, [selectedSolution?.regulations, selectedSolutionSteps, viewRegulations]);

  const flightPathsCard = (
    <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80">
          {viewMode === 'whole_plan' ? 'Spatial Overview' : 'Flight Paths'}
        </h3>
        {detailsLoading && (
          <ShimmeringText text="Loading…" className="text-xs text-white/55 font-normal" />
        )}
      </div>
      {viewMode === 'whole_plan' ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wide text-white/45">
              Flight Paths
            </div>
            <div className="h-[220px] overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
              <FlightPathsMiniMap flightIds={delayedFlightIds} className="h-full w-full" />
            </div>
          </div>
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wide text-white/45">
              Traffic Volumes
            </div>
            <div className="h-[220px] overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
              <TrafficVolumeMiniMap
                trafficVolumeIds={solutionTrafficVolumeIds}
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 h-[220px] overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
          <FlightPathsMiniMap flightIds={delayedFlightIds} className="h-full w-full" />
        </div>
      )}
    </div>
  );

  const binMinutes = useMemo(
    () => Number(detailsData?.pre_post?.time_bin_minutes) || 60,
    [detailsData?.pre_post?.time_bin_minutes],
  );

  const canRankOccAllChanges = useMemo(() => {
    const pre = detailsData?.pre_post?.pre_counts || {};
    const post = detailsData?.pre_post?.post_counts || {};
    const hasPre = Object.values(pre).some((series) => Array.isArray(series) && (series as any[]).length > 0);
    const hasPost = Object.values(post).some((series) => Array.isArray(series) && (series as any[]).length > 0);
    return hasPre && hasPost;
  }, [detailsData?.pre_post?.pre_counts, detailsData?.pre_post?.post_counts]);

  const hasOccCapacity = useMemo(() => {
    return Object.values(filteredCapacityCounts || {}).some(
      (series) =>
        Array.isArray(series) &&
        series.some((value) => Number.isFinite(Number(value))),
    );
  }, [filteredCapacityCounts]);

  useEffect(() => {
    const range = deriveViewRange(detailsData);
    const end = range.viewTo === '24:00' ? '23:59' : range.viewTo;
    setViewFrom(range.viewFrom || '00:00');
    setViewTo(end || '23:59');
  }, [detailsData, selectedStepNumber]);

  const stepButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const registerStepButton = useCallback(
    (stepNumber: number) => (element: HTMLButtonElement | null) => {
      if (!stepButtonRefs.current) {
        stepButtonRefs.current = new Map();
      }
      if (element) {
        stepButtonRefs.current.set(stepNumber, element);
      } else {
        stepButtonRefs.current.delete(stepNumber);
      }
    },
    [],
  );

  const handleStepSelect = useCallback(
    (stepNumber: number) => {
      startViewTransition(() => setSelectedStepNumber(stepNumber));
      const node = stepButtonRefs.current?.get(stepNumber);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    },
    [startViewTransition],
  );

  const handleFlightRowClick = useCallback(
    (flightId: string) => {
      setSelectedFlightIds((current) => {
        if (current.includes(flightId)) {
          return current.filter((id) => id !== flightId);
        }
        return [...current, flightId];
      });
      const match = flightsById.get(flightId);
      if (match && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('flight-search-select', { detail: { flight: match } }),
        );
      }
    },
    [flightsById],
  );

  const solutionMetricItems = useMemo(
    () => [
      { label: 'Flows', value: formatCount(solutionMetrics.flows) },
      { label: 'Flights', value: formatCount(solutionMetrics.flights ?? selectedStepAggregate?.flightCount) },
      { label: 'Delay (min)', value: formatMinutes(solutionMetrics.delayMinutes) },
    ],
    [solutionMetrics, selectedStepAggregate],
  );

  const runSolutionSummaries = selectedRzRun?.solutions ?? [];
  const historicalRewardData =
    selectedRzRun?.metadata?.historical_best?.map((entry) => ({
      time: new Date(entry.ts_iso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      value:
        entry.best_total_improvement !== null &&
        entry.best_total_improvement !== undefined
          ? entry.best_total_improvement
          : Number.NaN,
    })) ?? [];
  const latestHistoricalReward =
    historicalRewardData[historicalRewardData.length - 1]?.value;

  return (
    <div
      className={`grid min-h-[560px] transition-[grid-template-columns] duration-300 ease-out ${
        isFlightsPaneOpen
          ? 'grid-cols-[minmax(0,1fr)_minmax(320px,380px)]'
          : 'grid-cols-[minmax(0,1fr)_52px]'
      } text-white ${className}`}
    >
      {error ? (
        <section className="col-span-2 flex h-full items-center justify-center px-6 text-sm text-red-300">
          {error}
        </section>
      ) : !selectedRun ? (
        <section className="col-span-2 flex h-full items-center justify-center">
          {loading ? (
            <ShimmeringText
              text="Loading runs…"
              className="text-sm text-white/50 font-normal"
            />
          ) : (
            'Select a run to view its solutions.'
          )}
        </section>
      ) : selectedRun.ref.methodology === 'sa' ? (
        <AgentSaResultSummaryPanel
          run={selectedRun.ref}
          flightsPaneOpen={isFlightsPaneOpen}
          onFlightsPaneOpenChange={setIsFlightsPaneOpen}
        />
      ) : selectedRun.ref.methodology === 'ga' ? (
        <AgentGaResultSummaryPanel
          run={selectedRun.ref}
          flightsPaneOpen={isFlightsPaneOpen}
          onFlightsPaneOpenChange={setIsFlightsPaneOpen}
        />
      ) : (
        <>
          <section className="agent-result-summary__details-pane relative flex flex-col">
          <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-6">
            <div className="space-y-6">
              <div className="mb-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => startViewTransition(() => setViewMode('per_episode'))}
                  aria-pressed={viewMode === 'per_episode'}
                  className={`rounded-md border px-3 py-1.5 text-xs ${viewMode === 'per_episode'
                    ? 'border-emerald-400/70 bg-emerald-400/15'
                    : 'border-white/10 bg-white/5 hover:border-white/20'
                    }`}
                >
                  Per Episode
                </button>
                <button
                  type="button"
                  onClick={() => startViewTransition(() => setViewMode('whole_plan'))}
                  aria-pressed={viewMode === 'whole_plan'}
                  className={`rounded-md border px-3 py-1.5 text-xs ${viewMode === 'whole_plan'
                    ? 'border-emerald-400/70 bg-emerald-400/15'
                    : 'border-white/10 bg-white/5 hover:border-white/20'
                    }`}
                >
                  Whole Plan
                </button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_40px_-24px_rgba(15,118,110,0.9)] backdrop-blur-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold text-white/90">
                        Solution Preview
                      </h2>
                      {bestLoading && (
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                          Refreshing…
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-white/60">
                      Run {selectedRzRun.run_id}
                      {lastUpdated ? ` · Updated ${lastUpdated}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {solutionMetricItems.map((item) => (
                      <div
                        key={item.label}
                        className="min-w-[96px] px-3 py-2 text-right"
                      >
                        <div className="text-[11px] uppercase tracking-wide text-white/45">
                          {item.label}
                        </div>
                        <div className="text-sm font-semibold text-white/90">
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-wide text-white/45">
                    Solution Rank
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {bestSolutions.length === 0 && !bestLoading ? (
                      <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/60">
                        No solutions returned for this run.
                      </div>
                    ) : null}
                    {bestSolutions.map((solution) => {
                      const isSelected = solution.rank === selectedSolutionRank;
                      const summary = runSolutionSummaries.find(
                        (item) => item.rank === solution.rank,
                      );
                      const solutionSteps = getSolutionSteps(solution);
                      const trajectoryLength =
                        solutionSteps.length > 0
                          ? solutionSteps.length
                          : summary?.trajectory_length ?? null;
                      const trajectoryLabel =
                        trajectoryLength !== null && trajectoryLength !== undefined
                          ? formatTrajectoryLength(trajectoryLength)
                          : null;
                      return (
                        <button
                          key={`solution-rank-${solution.rank}`}
                          type="button"
                          onClick={() => startViewTransition(() => setSelectedSolutionRank(solution.rank))}
                          aria-pressed={isSelected}
                          className={`min-w-[150px] rounded-xl border px-4 py-3 text-left transition ${isSelected
                            ? 'border-emerald-400/70 bg-emerald-500/15 shadow-[0_14px_30px_-18px_rgba(16,185,129,0.9)]'
                            : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                            }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-white/90">
                              Rank {solution.rank}
                              {trajectoryLabel ? ` · ${trajectoryLabel}` : ''}
                            </span>
                            {summary ? (
                              <span className="text-xs font-medium text-emerald-300">
                                {formatImprovement(summary.total_improvement)}
                              </span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {historicalRewardData.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-500/[0.08] via-black/25 to-slate-950/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-white/90">
                          Historical Reward
                        </h3>
                        <p className="mt-1 text-xs text-white/55">
                          Best total improvement over the lifetime of this run
                        </p>
                      </div>
                      <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-right">
                        <div className="text-[10px] uppercase tracking-wide text-emerald-100/60">
                          Latest best
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-emerald-300">
                          {formatImprovement(latestHistoricalReward)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={historicalRewardData}
                          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                        >
                          <defs>
                            <linearGradient id="historicalRewardStroke" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="rgba(56, 189, 248, 0.85)" />
                              <stop offset="100%" stopColor="rgba(52, 211, 153, 1)" />
                            </linearGradient>
                          </defs>
                          <XAxis
                            dataKey="time"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={10}
                            minTickGap={28}
                            tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }}
                          />
                          <YAxis
                            width={48}
                            domain={['auto', 'auto']}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }}
                          />
                          <Tooltip content={historicalTooltip} />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="url(#historicalRewardStroke)"
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{
                              r: 4,
                              fill: 'rgb(52, 211, 153)',
                              stroke: 'rgba(15, 23, 42, 0.9)',
                              strokeWidth: 2,
                            }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                <div className="mt-5">
                  {viewMode === 'unselected' ? (
                    <div className="grid gap-6 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setViewMode('whole_plan')}
                        className="group relative flex flex-col items-start justify-between overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-8 text-left transition-all hover:border-emerald-500/50 hover:bg-emerald-500/[0.04] hover:shadow-[0_0_40px_-10px_rgba(16,185,129,0.3)]"
                      >
                        <div className="relative z-10">
                          <div className="mb-6 inline-flex rounded-2xl bg-emerald-500/10 p-4 text-emerald-400 ring-1 ring-inset ring-emerald-500/20 transition-colors group-hover:bg-emerald-500/20 group-hover:text-emerald-300">
                            <Presentation className="h-8 w-8" strokeWidth={1.5} />
                          </div>
                          <h3 className="text-xl font-bold text-white group-hover:text-emerald-300">Whole Plan View</h3>
                          <p className="mt-3 text-sm leading-relaxed text-white/60 group-hover:text-white/80">
                            Analyze aggregated statistics, flight paths, and occupancy impacts across the entire plan duration.
                          </p>
                        </div>
                        <div className="mt-8 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/40 group-hover:text-emerald-400">
                          Select View
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2} />
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setViewMode('per_episode')}
                        className="group relative flex flex-col items-start justify-between overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-8 text-left transition-all hover:border-blue-500/50 hover:bg-blue-500/[0.04] hover:shadow-[0_0_40px_-10px_rgba(59,130,246,0.3)]"
                      >
                        <div className="relative z-10">
                          <div className="mb-6 inline-flex rounded-2xl bg-blue-500/10 p-4 text-blue-400 ring-1 ring-inset ring-blue-500/20 transition-colors group-hover:bg-blue-500/20 group-hover:text-blue-300">
                            <List className="h-8 w-8" strokeWidth={1.5} />
                          </div>
                          <h3 className="text-xl font-bold text-white group-hover:text-blue-300">Per Episode View</h3>
                          <p className="mt-3 text-sm leading-relaxed text-white/60 group-hover:text-white/80">
                            Inspect detailed step-by-step decisions, regulations, and flow changes for each episode.
                          </p>
                        </div>
                        <div className="mt-8 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/40 group-hover:text-blue-400">
                          Select View
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2} />
                        </div>
                      </button>
                    </div>
                  ) : viewMode === 'per_episode' ? (
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
                      <div className="relative min-h-[280px] rounded-2xl border border-white/10 bg-black/30">
                        <div className="absolute inset-0 flex flex-col px-4 py-4">
                        <div className="flex shrink-0 items-center justify-between">
                          <h3 className="text-sm font-semibold text-white/80">Step Sequence</h3>
                          {selectedSolutionSteps.length ? (
                            <span className="text-xs text-white/50">
                              {selectedSolutionSteps.length} step
                              {selectedSolutionSteps.length === 1 ? '' : 's'}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto no-scrollbar pr-1">
                        {bestError ? (
                          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                            {bestError}
                          </div>
                        ) : bestLoading && !selectedSolution ? (
                          <div className="mt-4 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-5">
                            <ShimmeringText
                              text="Loading solution preview…"
                              className="text-sm text-white/60 font-normal"
                            />
                          </div>
                        ) : selectedSolutionSteps.length ? (
                          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                            {selectedSolutionSteps.map((step, index) => {
                              const stepNumber = getStepNumber(step) ?? index + 1;
                              const isActive = stepNumber === selectedStepNumber;
                              const controlVolume = getStepControlVolume(step) || 'Unknown CV';
                              const timeWindow = getStepTimeWindow(step) || '—';
                              const aggregate = stepAggregates.get(stepNumber);
                              const flows = flowDefinitionsByStep.get(stepNumber) ?? [];
                              const flightCount = aggregate?.flightCount ?? null;
                              return (
                                <button
                                  key={`solution-step-${stepNumber}`}
                                  type="button"
                                  ref={registerStepButton(stepNumber)}
                                  onClick={() => handleStepSelect(stepNumber)}
                                  className={`flex flex-col rounded-xl border px-3 py-2.5 text-left transition ${isActive
                                    ? 'border-emerald-400/70 bg-emerald-400/10 shadow-[0_18px_30px_-26px_rgba(16,185,129,0.7)]'
                                    : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                                    }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span
                                      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isActive
                                        ? 'bg-emerald-400/20 text-emerald-100'
                                        : 'bg-white/10 text-white/55'
                                        }`}
                                    >
                                      Step {stepNumber}
                                    </span>
                                    {flightCount !== null && (
                                      <span className="text-[11px] text-white/55">
                                        <span className="font-semibold text-white/85">
                                          {formatCount(flightCount)}
                                        </span>{' '}
                                        flight{flightCount === 1 ? '' : 's'}
                                      </span>
                                    )}
                                  </div>
                                  {(flows.length
                                    ? flows
                                    : [null]
                                  ).map((flow, flowIndex) => {
                                    const primaryLabel =
                                      flow?.controlVolume || controlVolume;
                                    const primaryWindow = flow?.timeWindow || timeWindow;
                                    const definingVolumes =
                                      flow?.metadata?.definingVolumes ?? [];
                                    return (
                                      <div
                                        key={flow?.key ?? `step-${stepNumber}-flow-${flowIndex}`}
                                        className={flowIndex > 0 ? 'mt-2 border-t border-white/10 pt-2' : 'mt-2'}
                                      >
                                        <div className="flex items-baseline gap-1.5">
                                          <span className="font-mono text-[11px] font-semibold text-emerald-300">
                                            H
                                          </span>
                                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/90">
                                            {primaryLabel}
                                          </span>
                                          {primaryWindow ? (
                                            <span className="shrink-0 font-mono text-[11px] text-white/55">
                                              {primaryWindow}
                                            </span>
                                          ) : null}
                                        </div>
                                        <DefiningVolumeChain
                                          volumes={definingVolumes}
                                          className="mt-1.5"
                                        />
                                      </div>
                                    );
                                  })}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/60">
                            No steps available for this solution.
                          </div>
                        )}
                        </div>
                        </div>
                      </div>
                      {flightPathsCard}
                    </div>
                  ) : (
                    flightPathsCard
                  )}
                </div>
              </div>

              {viewMode !== 'unselected' && (
                <>
                  {viewMode === 'whole_plan' && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_16px_36px_-24px_rgba(56,189,248,0.75)] backdrop-blur-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-white/90">
                          Regulation Flow Definitions
                        </h3>
                        <p className="text-xs text-white/60">
                          Defining volumes grouped by regulation step
                        </p>
                      </div>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/60">
                        {flowDefinitionRows.length} flow
                        {flowDefinitionRows.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="mt-4">
                      {detailsLoading && flowDefinitionRows.length === 0 ? (
                        <div className="flex min-h-[96px] items-center justify-center rounded-xl border border-white/10 bg-black/25">
                          <ShimmeringText
                            text="Loading flow definitions…"
                            className="text-sm text-white/60 font-normal"
                          />
                        </div>
                      ) : detailsError && flowDefinitionRows.length === 0 ? (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                          {detailsError}
                        </div>
                      ) : flowDefinitionRows.length > 0 ? (
                        <div className="space-y-3">
                          {flowDefinitionRows.map((row, index) => {
                            const hasVpfDefinition = Boolean(row.metadata?.definingVolumes?.length);
                            return (
                              <div
                                key={`${row.key}-${index}`}
                                className="rounded-xl border border-white/10 bg-black/25 px-4 py-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {row.stepNumber !== null ? (
                                        <span className="rounded-md bg-sky-400/15 px-2 py-1 text-[11px] font-semibold text-sky-100">
                                          Step {row.stepNumber}
                                        </span>
                                      ) : null}
                                      {row.flowId ? (
                                        <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/70">
                                          Flow #{row.flowId}
                                        </span>
                                      ) : null}
                                      {row.metadata?.definitionSize ? (
                                        <span className="rounded-md bg-emerald-400/15 px-2 py-1 text-[11px] font-semibold text-emerald-100">
                                          VPF-{row.metadata.definitionSize}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="mt-2 truncate text-sm font-semibold text-white/90">
                                      {row.controlVolume || 'Unknown TV'}
                                      {row.timeWindow ? ` · ${row.timeWindow}` : ''}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    {row.flightCount !== null ? (
                                      <span className="rounded-lg bg-white/10 px-3 py-1 font-semibold text-white/70">
                                        {formatCount(row.flightCount)} flight
                                        {row.flightCount === 1 ? '' : 's'}
                                      </span>
                                    ) : null}
                                    {(row.baselineRate !== null && row.baselineRate !== undefined) ||
                                      (row.allowedRate !== null && row.allowedRate !== undefined) ? (
                                      <span className="rounded-lg bg-emerald-400/15 px-3 py-1 font-semibold text-emerald-200">
                                        {formatRate(row.baselineRate)} → {formatRate(row.allowedRate)}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                {hasVpfDefinition ? (
                                  <VpfDefiningVolumes metadata={row.metadata} className="px-0 pt-3" />
                                ) : (
                                  <div className="mt-3 rounded-lg border border-dashed border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/50">
                                    VPF defining volumes are unavailable for this flow.
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-white/15 bg-black/25 px-4 py-5 text-sm text-white/60">
                          No regulation flow definitions are available for this plan.
                        </div>
                      )}
                    </div>
                  </div>
                  )}

                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_40px_-24px_rgba(14,116,144,0.8)] backdrop-blur-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-white/90">
                          Occupancy Count Changes
                        </h3>
                        <p className="text-xs text-white/60">
                          {viewMode === 'per_episode'
                            ? selectedStep
                              ? `${getStepControlVolume(selectedStep) || 'Unknown CV'} · ${getStepTimeWindow(selectedStep) || 'Time window TBD'} · Step ${selectedStepNumber}`
                              : 'Select a step to view traffic volume impacts'
                            : 'Whole plan occupancy changes'}
                        </p>
                      </div>
                      {detailsError ? (
                        <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-200">
                          {detailsError}
                        </span>
                      ) : (
                        <span className="text-xs text-white/50">
                          View {viewFrom} → {viewTo}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(280px,1fr)_minmax(220px,260px)] items-end">
                      <div>
                        <TimeScaleControl
                          time_from={viewFrom}
                          time_to={viewTo}
                          stepMinutes={binMinutes}
                          onCommit={(f, t) => {
                            clearTimeout(commitTimeout.current);
                            commitTimeout.current = setTimeout(() => { setViewFrom(f); setViewTo(t); }, 150);
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-start lg:justify-end gap-2">
                        <select
                          className="h-[40px] px-3 text-[12px] rounded-md bg-white/10 border border-white/20 text-white/90 focus:outline-none"
                          value={occSortMode}
                          aria-label="Occupancy pre-post sort"
                          onChange={(e) => setOccSortMode(e.currentTarget.value as OccupancyPrePostSortMode)}
                        >
                          <option value="total">Rank by Total</option>
                          <option
                            value="abs_change"
                            disabled={!canRankOccAllChanges}
                            title={!canRankOccAllChanges ? 'Pre and post counts required to rank by changes.' : undefined}
                          >
                            Rank by Absolute Changes
                          </option>
                          <option
                            value="relative_change"
                            disabled={!canRankOccAllChanges}
                            title={!canRankOccAllChanges ? 'Pre and post counts required to rank by changes.' : undefined}
                          >
                            Rank by Relative Changes
                          </option>
                          <option
                            value="total_excess_reduced"
                            disabled={!canRankOccAllChanges || !hasOccCapacity}
                            title={
                              !canRankOccAllChanges
                                ? 'Pre and post counts required to rank by changes.'
                                : !hasOccCapacity
                                  ? 'Capacity data required to rank by total excess reduced.'
                                  : undefined
                            }
                          >
                            Total Excess Reduced
                          </option>
                          <option
                            value="total_excess_induced"
                            disabled={!canRankOccAllChanges || !hasOccCapacity}
                            title={
                              !canRankOccAllChanges
                                ? 'Pre and post counts required to rank by changes.'
                                : !hasOccCapacity
                                  ? 'Capacity data required to rank by total excess induced.'
                                  : undefined
                            }
                          >
                            Total Excess Induced
                          </option>
                          <option value="exceedance">By Exceedances</option>
                        </select>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-white/85">Global Pinned TVs</h4>
                          <p className="text-xs text-white/55">
                            Available global pins are summarized here and promoted in the histogram grid.
                          </p>
                        </div>
                      </div>
                      <div className="mt-4">
                        {pinnedSummaries.length > 0 ? (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {pinnedSummaries.map((item) => (
                              <TrafficVolumeInfoTooltip
                                key={`pinned-tv-${item.tv}`}
                                trafficVolumeId={item.tv}
                                className="block"
                              >
                                <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4 transition hover:border-white/20">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="text-sm font-semibold text-white/90">
                                      TV {item.tv}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleUnpinTrafficVolume(item.tv)}
                                      className="text-xs text-white/60 transition hover:text-red-200"
                                    >
                                      Unpin
                                    </button>
                                  </div>
                                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] text-white/70">
                                    {item.peakPost !== null ? (
                                      <div>
                                        <dt className="uppercase tracking-wide text-white/45">Post peak</dt>
                                        <dd className="font-semibold text-white/90">
                                          {formatCount(item.peakPost)}
                                        </dd>
                                      </div>
                                    ) : null}
                                    {item.peakPre !== null ? (
                                      <div>
                                        <dt className="uppercase tracking-wide text-white/45">Pre peak</dt>
                                        <dd className="font-semibold text-white/90">
                                          {formatCount(item.peakPre)}
                                        </dd>
                                      </div>
                                    ) : null}
                                    {item.peakCap !== null ? (
                                      <div>
                                        <dt className="uppercase tracking-wide text-white/45">Capacity</dt>
                                        <dd className="font-semibold text-white/90">
                                          {formatCount(item.peakCap)}
                                        </dd>
                                      </div>
                                    ) : null}
                                    {item.exceedance !== null ? (
                                      <div>
                                        <dt className="uppercase tracking-wide text-white/45">Max exceed.</dt>
                                        <dd
                                          className={`font-semibold ${item.exceedance > 0 ? 'text-amber-300' : 'text-white/80'
                                            }`}
                                        >
                                          {item.exceedance > 0
                                            ? `+${formatCount(item.exceedance)}`
                                            : formatCount(item.exceedance)}
                                        </dd>
                                      </div>
                                    ) : null}
                                  </dl>
                                </div>
                              </TrafficVolumeInfoTooltip>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-5 text-xs text-white/60">
                            {availableTrafficVolumes.length
                              ? 'No globally pinned traffic volumes are available in this result.'
                              : viewMode === 'per_episode'
                                ? 'No traffic volume data available for this step.'
                                : 'No traffic volume data available for this plan.'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                      <OccupancyPrePostPanel
                        postCounts={detailsData?.pre_post?.post_counts ?? EMPTY_OCC}
                        preCounts={detailsData?.pre_post?.pre_counts ?? undefined}
                        capacity={filteredCapacityCounts}
                        hotspotDiffs={detailsData?.pre_post ?? null}
                        tvOrder={detailsData?.pre_post?.tv_ids_order ?? undefined}
                        binMinutes={binMinutes}
                        viewFrom={viewFrom}
                        viewTo={viewTo}
                        sortMode={occSortMode}
                        onSortModeChange={(m) => setOccSortMode(m)}
                        loading={detailsLoading}
                        error={detailsError}
                        showReliefMap
                        reliefMapTitle="Traffic Volume Relief Map"
                        compact
                        showLabels={false}
                      />
                    </div>

                    {viewMode === 'per_episode' ? (
                      <div className="mt-4 space-y-4">
                        <PerStageRewardPanel
                          rewards={detailsData?.per_stage_reward}
                          selectedStepNumber={selectedStepNumber}
                          loading={detailsLoading}
                          error={detailsError}
                          truncated={Boolean(detailsData?.metadata?.stage_reward_truncated)}
                        />
                        <PerAccDelayAttributionPanel
                          perAccAttrib={detailsData?.per_acc_attrib}
                          mode={perAccAttribMode}
                          loading={detailsLoading}
                          error={detailsError}
                          onModeChange={setPerAccAttribMode}
                          variant="page"
                          unavailableMessage="ACC attribution is unavailable for this step detail response. Try switching attribution mode or select a different step."
                        />
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                        <PerAccDelayAttributionPanel
                          perAccAttrib={detailsData?.per_acc_attrib}
                          mode={perAccAttribMode}
                          loading={detailsLoading}
                          error={detailsError}
                          onModeChange={setPerAccAttribMode}
                          variant="page"
                          unavailableMessage="ACC attribution is unavailable for this whole-plan detail response. Try switching attribution mode or select a different solution."
                        />
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_32px_-20px_rgba(8,145,178,0.7)] backdrop-blur-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-white/90">
                          Breakdown by Airport / Routes
                        </h3>
                        <p className="text-xs text-white/60">
                          {viewMode === 'per_episode'
                            ? 'Aggregated statistics for delayed flights in this step.'
                            : 'Aggregated statistics for delayed flights across the plan.'}
                        </p>
                      </div>
                      <span className="text-xs text-white/55">
                        {flightRows.length} flight
                        {flightRows.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
                      {detailsLoading && flightRows.length === 0 ? (
                        <div className="flex h-[160px] items-center justify-center">
                          <ShimmeringText
                            text="Loading flight statistics…"
                            className="text-sm text-white/60 font-normal"
                          />
                        </div>
                      ) : detailsError && flightRows.length === 0 ? (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                          {detailsError}
                        </div>
                      ) : flightRows.length > 0 ? (
                        <FlightListStatistics
                          flightIds={flightRows.map((row) => row.flightId)}
                          metadata={detailsData?.metadata ?? undefined}
                          className="bg-transparent"
                          show_occupancy_charts={false}
                        />
                      ) : (
                        <div className="flex h-[120px] items-center justify-center text-sm text-white/60">
                          No flight metrics available yet.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          </section>

          <aside className="agent-result-summary__flights-pane relative flex min-w-0 flex-col overflow-hidden border-l border-white/5">
        {!isFlightsPaneOpen ? (
          <button
            type="button"
            onClick={() => setIsFlightsPaneOpen(true)}
            className="group flex h-full w-full flex-col items-center gap-3 bg-white/[0.02] py-4 text-white/55 transition hover:bg-white/[0.06] hover:text-white/90"
            aria-label={`Show flight assignments (${flightRows.length} flights)`}
            title="Show flight assignments"
          >
            <ChevronRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5" strokeWidth={1.8} />
            <span className="rounded-full bg-white/10 px-1.5 py-1 text-[10px] font-semibold text-white/75">
              {flightRows.length}
            </span>
            <span className="mt-4 rotate-90 whitespace-nowrap text-xs font-medium text-white/65">
              Flights
            </span>
          </button>
        ) : !selectedRun ? (
          <div className="flex h-full items-center justify-center text-sm text-white/60">
            Select a run to view flight impacts.
          </div>
        ) : (
          <>
            <div className="border-b border-white/10 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white/85">
                    {viewMode === 'per_episode'
                      ? `Flights for Step ${selectedStepNumber}`
                      : 'Flights (Whole Plan)'}
                  </h3>
                  <p className="text-xs text-white/55">
                    {viewMode === 'per_episode'
                      ? selectedStep
                        ? `${getStepControlVolume(selectedStep) || 'Unknown CV'} · ${getStepTimeWindow(selectedStep) || 'Time window TBD'}`
                        : 'Select a step to view impacted flights'
                      : 'All flights with assigned delays across the plan'}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <div className="text-right text-[11px] uppercase tracking-wide text-white/45">
                    <div>{flightRows.length} flights</div>
                    <div>
                      {selectedFlightIds.length} selected
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsFlightsPaneOpen(false)}
                    className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/55 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                    aria-label="Collapse flight assignments"
                    title="Collapse flight assignments"
                  >
                    <ChevronLeft className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4">
              {detailsLoading ? (
                <div className="flex h-full justify-center">
                  <ShimmeringText
                    text="Loading flights…"
                    className="text-sm text-white/60 font-normal"
                  />
                </div>
              ) : detailsError && flightRows.length === 0 ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {detailsError}
                </div>
              ) : (flowGroups.length > 0 ? (
                <div className="space-y-3">
                  {flowGroups.map((group, gi) => (
                    <div
                      key={`${group.key}-${gi}`}
                      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.08] p-3 shadow-[0_16px_40px_-28px_rgba(56,189,248,0.5)] backdrop-blur-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 backdrop-blur-sm">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white/90 truncate">
                            {group.label}
                          </div>
                          <div className="text-[11px] uppercase tracking-wide text-white/45">
                            {group.rows.length} flight{group.rows.length === 1 ? '' : 's'}
                          </div>
                        </div>
                        {(group.baselineRate !== null && group.baselineRate !== undefined) ||
                          (group.allowedRate !== null && group.allowedRate !== undefined) ? (
                          <div className="rounded-lg bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                            {formatRate(group.baselineRate)} → {formatRate(group.allowedRate)}
                          </div>
                        ) : null}
                      </div>
                      <VpfDefiningVolumes
                        metadata={group.metadata}
                        className="px-0 pt-3"
                      />
                      <FlowGroupMiniMapTooltip
                        flightIds={group.flightIds}
                        className="mt-3"
                      />
                      <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-slate-950/40">
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-[11px] text-white/85">
                            <thead className="bg-white/10 text-white/60">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold">CS</th>
                                <th className="px-3 py-2 text-left font-semibold">Ori.</th>
                                <th className="px-3 py-2 text-left font-semibold">Des.</th>
                                <th className="px-3 py-2 text-right font-semibold">Delay (min)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((row, idx) => {
                                const isSelected = selectedFlightIds.includes(row.flightId);
                                const showCheck = isSelected || row.targeted;
                                return (
                                  <tr
                                    key={`${group.key}-${row.flightId}`}
                                    className={`border-t border-white/10 ${idx % 2 === 0 ? 'bg-white/0' : 'bg-white/10'} hover:bg-emerald-500/20 cursor-pointer transition`}
                                    onClick={() => handleFlightRowClick(row.flightId)}
                                  >
                                    <td className="px-3 py-2 font-mono">
                                      {showCheck ? '✓ ' : ''}
                                      {row.callsign}
                                    </td>
                                    <td className="px-3 py-2">{row.origin}</td>
                                    <td className="px-3 py-2">{row.destination}</td>
                                    <td className="px-3 py-2 text-right font-mono">{formatMinutes(row.delayMinutes)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : flightRows.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_12px_30px_-20px_rgba(8,145,178,0.6)]">
                  <table className="w-full table-fixed text-xs text-white/80">
                    <thead>
                      <tr className="bg-white/10 text-[11px] uppercase tracking-wide text-white/55">
                        <th className="w-10 px-3 py-2 text-center">✓</th>
                        <th className="w-24 px-3 py-2 text-left">Callsign</th>
                        <th className="w-16 px-3 py-2 text-left">Origin</th>
                        <th className="w-16 px-3 py-2 text-left">Dest</th>
                        <th className="px-3 py-2 text-right">Delay (min)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flightRows.map((row, index) => {
                        const isSelected = selectedFlightIds.includes(row.flightId);
                        const showCheck = isSelected || row.targeted;
                        return (
                          <tr
                            key={row.flightId}
                            onClick={() => handleFlightRowClick(row.flightId)}
                            className={`cursor-pointer border-t border-white/10 text-sm transition ${showCheck
                              ? 'bg-emerald-500/15 hover:bg-emerald-500/20'
                              : index % 2 === 0
                                ? 'bg-white/5 hover:bg-white/10'
                                : 'bg-white/10 hover:bg-white/15'
                              }`}
                          >
                            <td className="px-3 py-2 text-center text-sm font-semibold text-white/90">
                              {showCheck ? '✓' : ''}
                            </td>
                            <td className="px-3 py-2 font-mono text-sm text-white">
                              {row.callsign}
                            </td>
                            <td className="px-3 py-2 text-sm">{row.origin}</td>
                            <td className="px-3 py-2 text-sm">{row.destination}</td>
                            <td className="px-3 py-2 text-right font-mono text-sm">
                              {formatMinutes(row.delayMinutes)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-white/60">
                  {viewMode === 'per_episode'
                    ? 'No flights available for this step.'
                    : 'No flights available for this plan.'}
                </div>
              ))}
            </div>
          </>
        )}
          </aside>
        </>
      )}
    </div >
  );
}
