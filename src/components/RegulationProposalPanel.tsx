"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import ShimmeringText from "@/components/ShimmeringText";
import { useSimStore } from "@/components/useSimStore";
import PanelCloseButton from "@/components/PanelCloseButton";
import type { FlowBasketItem } from "@/components/useSimStore";
import {
  RegulationProposal,
  collectProposalFlights,
  ProposalFlow,
} from "@/lib/regulationProposals";
import FlightStatisticsDialog from "@/components/FlightStatisticsDialog";
import FlightQueryDialog from "@/components/FlightQueryDialog";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import type { Trajectory } from "@/lib/models";

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return value.toFixed(digits);
}

type RegulationProposalPanelProps = {
  embedded?: boolean;
};

type FeatureSummary = {
  vAvg: number | null;
  slack15Avg: number | null;
  slack30Avg: number | null;
  totalFlights: number;
};

function summarizeProposalFeatures(proposal: RegulationProposal): FeatureSummary {
  const accumulator = {
    vSum: 0,
    vCount: 0,
    s15Sum: 0,
    s15Count: 0,
    s30Sum: 0,
    s30Count: 0,
    flights: 0,
  };
  for (const flow of proposal.flows || []) {
    const features = flow.features || {};
    if (typeof features.v_tilde === "number") {
      accumulator.vSum += features.v_tilde;
      accumulator.vCount += 1;
    }
    if (typeof features.slack15 === "number") {
      accumulator.s15Sum += features.slack15;
      accumulator.s15Count += 1;
    }
    if (typeof features.slack30 === "number") {
      accumulator.s30Sum += features.slack30;
      accumulator.s30Count += 1;
    }
    if (typeof features.num_flights === "number") {
      accumulator.flights += features.num_flights;
    } else {
      accumulator.flights += flow.flight_ids?.length || 0;
    }
  }
  return {
    vAvg: accumulator.vCount > 0 ? accumulator.vSum / accumulator.vCount : null,
    slack15Avg: accumulator.s15Count > 0 ? accumulator.s15Sum / accumulator.s15Count : null,
    slack30Avg: accumulator.s30Count > 0 ? accumulator.s30Sum / accumulator.s30Count : null,
    totalFlights: accumulator.flights,
  };
}

function summarizeFlowFeatures(flow: ProposalFlow) {
  const features = flow.features || {};
  return {
    v: typeof features.v_tilde === "number" ? features.v_tilde : null,
    slack15: typeof features.slack15 === "number" ? features.slack15 : null,
    slack30: typeof features.slack30 === "number" ? features.slack30 : null,
    flights: typeof features.num_flights === "number" ? features.num_flights : flow.flight_ids?.length || 0,
  };
}

type TimeRange = {
  from: string;
  to: string;
};

type TargetCellCombo = {
  volume: string;
  period: TimeRange;
};

type ProposalReviewContext =
  | { type: "flow"; proposal: RegulationProposal; flow: ProposalFlow }
  | { type: "proposal"; proposal: RegulationProposal };

function extractTimeRange(label?: string | null): TimeRange | null {
  if (!label) return null;
  const match = label.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[–-]\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (!match) return null;
  const normalize = (value: string) => {
    const parts = value.split(":");
    if (parts.length < 2) return value;
    const [hh, mm, ss] = parts;
    const hour = hh.padStart(2, "0");
    if (ss) {
      return `${hour}:${mm}:${ss}`;
    }
    return `${hour}:${mm}`;
  };
  return { from: normalize(match[1]), to: normalize(match[2]) };
}

function buildBasketItemsFromFlow(flow: ProposalFlow): FlowBasketItem[] {
  return (flow.flight_ids || []).map((flightId) => ({ key: String(flightId) }));
}

function resolveFlowPeriod(proposal: RegulationProposal, flow: ProposalFlow): TimeRange | null {
  return (
    extractTimeRange(flow.time_window_label) ||
    extractTimeRange(proposal.control_window?.label)
  );
}

export default function RegulationProposalPanel({ embedded = false }: RegulationProposalPanelProps) {
  const {
    isRegulationProposalPanelOpen,
    proposalLoading,
    proposalError,
    proposalResults,
    proposalQuery,
    proposalPreviewAll,
    proposalPinnedProposals,
    proposalPinnedFlows,
    flowThreshold,
    flowResolution,
    setFlowThreshold,
    setFlowResolution,
    togglePreviewAllProposals,
    toggleProposalEye,
    toggleProposalFlowEye,
    setProposalPreview,
    clearProposalPreview,
    fetchRegulationProposals,
    resetProposalState,
    flowBasket,
    addFlowBasket,
    addFlowBasketWithPeriod,
    addFlightsToBasketFlow,
    setFlowBasketPeriod,
    addTargetCells,
    flights,
  } = useSimStore();

  const [topKInput, setTopKInput] = useState<string>("");
  const [topKError, setTopKError] = useState<string | null>(null);
  const [expandedProposals, setExpandedProposals] = useState<Record<string, boolean>>({});
  const [expandedFlightLists, setExpandedFlightLists] = useState<Record<string, boolean>>({});
  const [showAllFlightLists, setShowAllFlightLists] = useState<Record<string, boolean>>({});
  const [statsDialog, setStatsDialog] = useState<{ flightIds: string[]; fullScreen?: boolean } | null>(null);
  const [openAddMenuFor, setOpenAddMenuFor] = useState<string | null>(null);
  const [reviewContext, setReviewContext] = useState<ProposalReviewContext | null>(null);

  useEffect(() => {
    const nextTopK = proposalQuery?.topK ?? proposalResults?.top_k;
    setTopKInput(nextTopK != null ? String(nextTopK) : "");
    setTopKError(null);
    setExpandedProposals({});
    setExpandedFlightLists({});
    setShowAllFlightLists({});
  }, [proposalQuery, proposalResults]);

  const showPanel = isRegulationProposalPanelOpen || proposalLoading;

  const uniqueFlowCount = useMemo(() => {
    const ids = new Set<string>();
    for (const proposal of proposalResults?.proposals || []) {
      for (const flow of proposal.flows || []) {
        ids.add(String(flow.flow_id));
      }
    }
    return ids.size;
  }, [proposalResults]);

  const reviewFlightIds = useMemo(() => {
    if (!reviewContext) return [] as string[];
    if (reviewContext.type === "flow") {
      return (reviewContext.flow.flight_ids || []).map((id) => String(id));
    }
    const set = new Set<string>();
    for (const flow of reviewContext.proposal.flows || []) {
      for (const id of flow.flight_ids || []) {
        set.add(String(id));
      }
    }
    return Array.from(set);
  }, [reviewContext]);

  const reviewLabels = useMemo(() => {
    if (!reviewContext) return { highlight: undefined as string | undefined, baseline: undefined as string | undefined };
    if (reviewContext.type === "flow") {
      const label = `${reviewContext.proposal.id} · Flow ${reviewContext.flow.flow_id}`;
      return { highlight: "Selected flights", baseline: label };
    }
    const label = `${reviewContext.proposal.id} · Proposal`;
    return { highlight: "Selected flights", baseline: label };
  }, [reviewContext]);

  const flightLookup = useMemo(() => {
    const map = new Map<string, Trajectory>();
    for (const flight of flights || []) {
      map.set(String(flight.flightId), flight);
    }
    return map;
  }, [flights]);

  if (!showPanel) {
    return null;
  }

  const containerClass = embedded
    ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
    : "absolute top-20 right-4 z-40 w-[420px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col";

  const proposals = proposalResults?.proposals || [];

  const handleReviewSelection = (selectedIds: string[]) => {
    if (!reviewContext) return;
    const selectedSet = new Set((selectedIds || []).map((id) => String(id)));
    if (selectedSet.size === 0) {
      setReviewContext(null);
      return;
    }

    if (reviewContext.type === "flow") {
      const { proposal, flow } = reviewContext;
      const items = buildBasketItemsFromFlow(flow).filter((item) => selectedSet.has(String(item.key)));
      if (items.length === 0) {
        setReviewContext(null);
        return;
      }
      const period = resolveFlowPeriod(proposal, flow);
      ensureFlowInBasket(`${proposal.id} · Flow ${flow.flow_id}`, items, period);
      const volume = flow.control_volume_id;
      if (volume && period) {
        applyTargetCellCombos([{ volume: String(volume), period }]);
      }
    } else {
      const { proposal } = reviewContext;
      const combos: TargetCellCombo[] = [];
      for (const flow of proposal.flows || []) {
        const items = buildBasketItemsFromFlow(flow).filter((item) => selectedSet.has(String(item.key)));
        if (items.length === 0) continue;
        const period = resolveFlowPeriod(proposal, flow);
        ensureFlowInBasket(`${proposal.id} · Flow ${flow.flow_id}`, items, period);
        const volume = flow.control_volume_id;
        if (volume && period) {
          combos.push({ volume: String(volume), period });
        }
      }
      if (combos.length > 0) {
        applyTargetCellCombos(combos);
      }
    }

    setReviewContext(null);
  };

  const handleCloseReview = () => {
    setReviewContext(null);
  };

  const handleRerun = async () => {
    if (!proposalQuery) return;
    let topK: number | undefined;
    if (topKInput.trim().length > 0) {
      const parsed = Number(topKInput);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setTopKError("Top K must be a positive number");
        return;
      }
      topK = Math.round(parsed);
    }
    setTopKError(null);
    await fetchRegulationProposals({
      trafficVolumeId: proposalQuery.trafficVolumeId,
      timeWindow: proposalQuery.timeWindow,
      topK,
      threshold: flowThreshold,
      resolution: flowResolution,
    });
  };

  const handleProposalHover = (proposal: RegulationProposal | null) => {
    if (!proposal) return;
    const ids = collectProposalFlights(proposal);
    setProposalPreview(ids, proposal.id);
  };

  const handleFlowHover = (proposal: RegulationProposal, flow: ProposalFlow) => {
    const ids = new Set((flow.flight_ids || []).map((id) => String(id)));
    setProposalPreview(ids, `${proposal.id}::${flow.flow_id}`);
  };

  const handleClearPreview = () => {
    clearProposalPreview();
  };

  const ensureFlowInBasket = (
    name: string,
    items: FlowBasketItem[],
    period?: TimeRange | null
  ) => {
    if (!items || items.length === 0) return;
    const existing = flowBasket.find((flow) => flow.name === name);
    if (existing) {
      addFlightsToBasketFlow(existing.id, items);
      if (period && period.from && period.to) {
        setFlowBasketPeriod(existing.id, period.from, period.to, { overwrite: false });
      }
      return existing.id;
    }
    if (period && period.from && period.to) {
      return addFlowBasketWithPeriod(name, items, period.from, period.to);
    }
    return addFlowBasket(name, items);
  };

  const applyTargetCellCombos = (combos: TargetCellCombo[]) => {
    if (!combos || combos.length === 0) return;
    const grouped = new Map<string, { from: string; to: string; volumes: Set<string> }>();
    for (const combo of combos) {
      const from = combo.period.from;
      const to = combo.period.to;
      if (!from || !to || from === to) continue;
      const key = `${from}::${to}`;
      const bucket = grouped.get(key) || { from, to, volumes: new Set<string>() };
      bucket.volumes.add(combo.volume);
      grouped.set(key, bucket);
    }
    grouped.forEach(({ from, to, volumes }) => {
      const list = Array.from(volumes);
      if (list.length === 0) return;
      addTargetCells(list, from, to);
    });
  };

  const addFlowFromProposal = (
    proposal: RegulationProposal,
    flow: ProposalFlow,
    combosAccumulator?: TargetCellCombo[]
  ) => {
    const items = buildBasketItemsFromFlow(flow);
    if (items.length === 0) return;
    const period = resolveFlowPeriod(proposal, flow);
    const label = `${proposal.id} · Flow ${flow.flow_id}`;
    ensureFlowInBasket(label, items, period);
    const volume = flow.control_volume_id;
    if (!volume || !period) return;
    const combo: TargetCellCombo = { volume: String(volume), period };
    if (combosAccumulator) {
      combosAccumulator.push(combo);
    } else {
      applyTargetCellCombos([combo]);
    }
  };

  const addEntireProposalToBasket = (proposal: RegulationProposal) => {
    const combos: TargetCellCombo[] = [];
    for (const flow of proposal.flows || []) {
      addFlowFromProposal(proposal, flow, combos);
    }
    applyTargetCellCombos(combos);
  };

  const renderFlightList = (proposalId: string, flow: ProposalFlow) => {
    const key = `${proposalId}::${flow.flow_id}`;
    const isOpen = expandedFlightLists[key] ?? false;
    if (!isOpen) return null;

    const flowFlightIds = flow.flight_ids || [];
    if (flowFlightIds.length === 0) {
      return (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] text-white/60">
          No flights listed
        </div>
      );
    }

    const MAX_VISIBLE = 20;
    const expanded = showAllFlightLists[key] ?? false;
    const rows = flowFlightIds.map((flightId) => {
      const lookup = flightLookup.get(String(flightId));
      const callSign = lookup?.callSign?.trim()
        ? String(lookup.callSign)
        : String(flightId);
      return {
        flightId: String(flightId),
        callSign,
        origin: lookup?.origin || "N/A",
        destination: lookup?.destination || "N/A",
      };
    });

    const visibleRows = expanded ? rows : rows.slice(0, MAX_VISIBLE);
    const hiddenCount = Math.max(0, rows.length - MAX_VISIBLE);

    return (
      <div className="mt-3">
        <div className="overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-white/10 text-white/70">
                <th className="px-2 py-2 text-left font-semibold">Flight</th>
                <th className="px-2 py-2 text-left font-semibold">Origin</th>
                <th className="px-2 py-2 text-left font-semibold">Destination</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.flightId}
                  className="border-t border-white/10 transition-colors hover:bg-white/10"
                >
                  <td className="px-2 py-1.5">
                    <div className="font-mono text-white/90">{row.callSign}</div>
                    {row.callSign !== row.flightId && (
                      <div className="text-[10px] text-white/50">{row.flightId}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{row.origin}</td>
                  <td className="px-2 py-1.5">{row.destination}</td>
                </tr>
              ))}
              {hiddenCount > 0 && (
                <tr
                  className="cursor-pointer border-t border-white/10 hover:bg-white/10"
                  onClick={() =>
                    setShowAllFlightLists((prev) => ({ ...prev, [key]: !expanded }))
                  }
                >
                  <td
                    className="px-2 py-1.5 text-center italic text-white/70"
                    colSpan={3}
                  >
                    {expanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenCount)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between p-4 border-b border-white/20">
        <div>
          <div className="text-lg font-semibold">Regulation Proposals</div>
          <div className="text-xs opacity-70">({uniqueFlowCount} flows)</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-label="Preview all proposal flights"
            aria-pressed={proposalPreviewAll}
            type="button"
            onClick={togglePreviewAllProposals}
            title={proposalPreviewAll ? "Hide all previews" : "Preview all proposal flights"}
            className={`h-7 w-7 flex items-center justify-center rounded-lg border transition-colors ${proposalPreviewAll
              ? 'border-blue-400 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
              : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zm11 3a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          </button>
          <button
            aria-label="Re-run regulation proposals"
            disabled={!proposalQuery || proposalLoading || !!topKError}
            type="button"
            onClick={handleRerun}
            title={proposalLoading ? "Loading..." : "Re-run with current parameters"}
            className={`h-7 w-7 flex items-center justify-center rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${proposalLoading
              ? 'border-blue-400/50 bg-blue-500/20 text-blue-100'
              : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={proposalLoading ? 'animate-spin' : ''}>
            <path fill-rule="evenodd" clip-rule="evenodd" d="M2.93077 11.2003C3.00244 6.23968 7.07619 2.25 12.0789 2.25C15.3873 2.25 18.287 3.99427 19.8934 6.60721C20.1103 6.96007 20.0001 7.42199 19.6473 7.63892C19.2944 7.85585 18.8325 7.74565 18.6156 7.39279C17.2727 5.20845 14.8484 3.75 12.0789 3.75C7.8945 3.75 4.50372 7.0777 4.431 11.1982L4.83138 10.8009C5.12542 10.5092 5.60029 10.511 5.89203 10.8051C6.18377 11.0991 6.18191 11.574 5.88787 11.8657L4.20805 13.5324C3.91565 13.8225 3.44398 13.8225 3.15157 13.5324L1.47176 11.8657C1.17772 11.574 1.17585 11.0991 1.46759 10.8051C1.75933 10.5111 2.2342 10.5092 2.52824 10.8009L2.93077 11.2003ZM19.7864 10.4666C20.0786 10.1778 20.5487 10.1778 20.8409 10.4666L22.5271 12.1333C22.8217 12.4244 22.8245 12.8993 22.5333 13.1939C22.2421 13.4885 21.7673 13.4913 21.4727 13.2001L21.0628 12.7949C20.9934 17.7604 16.9017 21.75 11.8825 21.75C8.56379 21.75 5.65381 20.007 4.0412 17.3939C3.82366 17.0414 3.93307 16.5793 4.28557 16.3618C4.63806 16.1442 5.10016 16.2536 5.31769 16.6061C6.6656 18.7903 9.09999 20.25 11.8825 20.25C16.0887 20.25 19.4922 16.9171 19.5625 12.7969L19.1546 13.2001C18.86 13.4913 18.3852 13.4885 18.094 13.1939C17.8028 12.8993 17.8056 12.4244 18.1002 12.1333L19.7864 10.4666Z" fill="currentColor"/>
            </svg>
          </button>
          <PanelCloseButton
            ariaLabel="Close regulation proposal panel"
            onClick={resetProposalState}
            title="Close panel"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
        {proposalError && (
          <div className="rounded-lg border border-red-300/40 bg-red-400/10 px-3 py-2 text-xs text-red-100">
            {proposalError}
          </div>
        )}

        {proposalResults && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-3 py-1">TV: {proposalResults.traffic_volume_id}</span>
            <span className="rounded-full bg-white/10 px-3 py-1">Window: {proposalResults.time_window}</span>
            <span className="rounded-full bg-white/10 px-3 py-1">Bin: {proposalResults.time_bin_minutes} min</span>
            <span className="rounded-full bg-white/10 px-3 py-1">Top K: {proposalResults.top_k}</span>
          </div>
        )}

        <div className="space-y-2 text-xs">
          <div className="flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="opacity-70">K proposals</span>
              <input
                type="number"
                min={1}
                className="h-9 w-full rounded-md border border-white/20 bg-white/10 px-2 text-right text-white focus:outline-none focus:ring-2 focus:ring-blue-300/40"
                value={topKInput}
                onChange={(e) => {
                  setTopKInput(e.target.value);
                }}
                placeholder={proposalResults?.top_k ? String(proposalResults.top_k) : ""}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="opacity-70">Threshold</span>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.05}
                value={flowThreshold}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setFlowThreshold(Math.min(10, Math.max(0.1, v)));
                }}
                className="h-9 w-full rounded-md border border-white/20 bg-white/10 px-2 text-right text-white focus:outline-none focus:ring-2 focus:ring-blue-300/40"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="opacity-70">Resolution</span>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={flowResolution}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setFlowResolution(Math.min(10, Math.max(0.1, v)));
                }}
                className="h-9 w-full rounded-md border border-white/20 bg-white/10 px-2 text-right text-white focus:outline-none focus:ring-2 focus:ring-blue-300/40"
              />
            </label>
          </div>
          {topKError && <span className="text-[11px] text-red-200">{topKError}</span>}
        </div>

        {proposalLoading && (
          <div className="flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-6 text-sm text-white/80">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]" />
              <ShimmeringText text="Hunting for Regulations..." className="text-sm opacity-80" />
            </div>
          </div>
        )}

        {!proposalLoading && proposals.length === 0 && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            No regulation proposals returned for this request.
          </div>
        )}

        {!proposalLoading && proposals.map((proposal) => {
          const expanded = expandedProposals[proposal.id] ?? false;
          const summary = summarizeProposalFeatures(proposal);
          const improvement = proposal.objective_improvement || { delta_objective_score: 0 };
          const deltaObjective = improvement.delta_objective_score ?? 0;
          const formattedDeltaObjective = deltaObjective > 0 ? `+${formatNumber(deltaObjective)}` : formatNumber(deltaObjective);
          const objectivePositive = deltaObjective > 0;
          const objectiveBadgeClasses = objectivePositive
            ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
            : "border-rose-400/40 bg-rose-500/20 text-rose-100";
          const isPinned = proposalPreviewAll || proposalPinnedProposals.has(proposal.id);
          const proposalFlights = Array.from(collectProposalFlights(proposal)).map((id) => String(id));
          const hasProposalFlights = proposalFlights.length > 0;
          const proposalMenuKey = `proposal:${proposal.id}`;
          const proposalMenuOpen = openAddMenuFor === proposalMenuKey;
          return (
            <div
              key={proposal.id}
              className="rounded-xl border border-white/15 bg-white/10"
              onMouseLeave={handleClearPreview}
            >
              <div
                className={`flex cursor-pointer flex-col gap-2 p-4 transition-colors hover:bg-white/10 ${isPinned ? 'border-l-4 border-l-blue-400' : ''}`}
                onMouseEnter={() => handleProposalHover(proposal)}
                onClick={() =>
                  setExpandedProposals((prev) => ({ ...prev, [proposal.id]: !expanded }))
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold truncate max-w-[100px]">{proposal.id}</div>
                    <div className="text-[11px] opacity-70">{proposal.control_window?.label} · ({proposal.flows?.length || 0} flows)</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium ${objectiveBadgeClasses}`}
                      title={`Δ ${formattedDeltaObjective}`}
                    >
                      <span>Δ: {formattedDeltaObjective}</span>
                    </div>
                    <button
                      aria-label={`Toggle preview for ${proposal.id}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleProposalEye(proposal.id);
                      }}
                      title={isPinned ? "Hide preview" : "Show preview"}
                      className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${isPinned
                        ? 'border-blue-400 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                        : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zm11 3a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                    </button>
                    <button
                      aria-label={`Expand details for ${proposal.id}`}
                      aria-expanded={expanded}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedProposals((prev) => ({ ...prev, [proposal.id]: !expanded }));
                      }}
                      title={expanded ? "Collapse details" : "Expand details"}
                      className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${expanded
                        ? 'border-blue-400 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                        : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                      >
                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] opacity-80">
                  <span className="rounded-full bg-white/5 px-2 py-1">V {formatNumber(summary.vAvg)}</span>
                  <span className="rounded-full bg-white/5 px-2 py-1">S15 {formatNumber(summary.slack15Avg)}</span>
                  <span className="rounded-full bg-white/5 px-2 py-1">S30 {formatNumber(summary.slack30Avg)}</span>
                  <span className="rounded-full bg-white/5 px-2 py-1">N {summary.totalFlights}</span>
                </div>
              </div>
              {expanded && (
                <div className="space-y-4 border-t border-white/10 p-4 text-xs">
                  <div className="grid gap-2">
                    <div className="font-semibold text-white/80">Objective Components</div>
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="text-white/60">
                          <th className="py-1 pr-2">Component</th>
                          <th className="py-1 px-2 text-right">Before</th>
                          <th className="py-1 px-2 text-right">After</th>
                          <th className="py-1 pl-2 text-right">Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(new Set([
                          ...Object.keys(proposal.objective_components?.before || {}),
                          ...Object.keys(proposal.objective_components?.after || {}),
                          ...Object.keys(proposal.objective_components?.delta || {}),
                        ])).map((key) => (
                          <tr key={key} className="border-t border-white/10">
                            <td className="py-1.5 pr-2 font-medium">{key}</td>
                            <td className="py-1.5 px-2 text-right">{formatNumber(proposal.objective_components?.before?.[key])}</td>
                            <td className="py-1.5 px-2 text-right">{formatNumber(proposal.objective_components?.after?.[key])}</td>
                            <td className="py-1.5 pl-2 text-right">{formatNumber(proposal.objective_components?.delta?.[key])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <div className="mb-2 font-semibold text-white/80">Flows</div>
                    <div className="space-y-3">
                      {proposal.flows?.map((flow) => {
                        const key = `${proposal.id}::${flow.flow_id}`;
                        const flowFeatures = summarizeFlowFeatures(flow);
                        const flowPinned = proposalPreviewAll || proposalPinnedFlows.has(key);
                        const flightListOpen = expandedFlightLists[key] ?? false;
                        const hasFlightIds = (flow.flight_ids?.length ?? 0) > 0;
                        const flowMenuKey = `flow:${proposal.id}::${flow.flow_id}`;
                        const flowMenuOpen = openAddMenuFor === flowMenuKey;
                        return (
                          <div
                            key={key}
                            className={`rounded-lg border border-white/15 bg-white/5 p-3 transition-colors hover:bg-white/10 ${flowPinned ? 'border-blue-400/70' : ''}`}
                            onMouseEnter={() => handleFlowHover(proposal, flow)}
                            onMouseLeave={handleClearPreview}
                          >
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="font-semibold text-sm">Flow {flow.flow_id}</div>
                                  <div className="text-white/70 text-xs">{flow.control_volume_id || '—'}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    aria-label={`Toggle preview for flow ${flow.flow_id}`}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleProposalFlowEye(proposal.id, flow.flow_id);
                                    }}
                                    title={flowPinned ? "Hide flow preview" : "Show flow preview"}
                                    className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${flowPinned
                                      ? 'border-blue-400 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                                      : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zm11 3a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/>
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`View flight statistics for flow ${flow.flow_id}`}
                                    title="Flight statistics"
                                    disabled={!hasFlightIds}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!flow.flight_ids?.length) return;
                                      setStatsDialog({ flightIds: flow.flight_ids.map((id) => String(id)), fullScreen: true });
                                    }}
                                    className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${hasFlightIds
                                      ? 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'
                                      : 'cursor-not-allowed border-white/10 bg-white/5 text-white/40'}`}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M16.3891 8.11096L8.61091 15.8891" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M16.3891 8.11096L16.7426 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M16.3891 8.11096L12.5 7.75741" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedFlightLists((prev) => {
                                        const next = !(prev[key] ?? false);
                                        if (!next) {
                                          setShowAllFlightLists((rows) => {
                                            if (rows[key] === undefined) return rows;
                                            const { [key]: _removed, ...rest } = rows;
                                            return rest;
                                          });
                                        }
                                        return { ...prev, [key]: next };
                                      });
                                    }}
                                    type="button"
                                    aria-label={flightListOpen ? 'Hide flight list' : 'Show flight list'}
                                    className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${flightListOpen
                                      ? 'border-blue-400 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                                      : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
                                    title={flightListOpen ? 'Hide flight list' : 'Show flight list'}
                                  >
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      xmlns="http://www.w3.org/2000/svg"
                                    >
                                      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
                                <div className="flex justify-between">
                                  <span className="text-white/60">Rate:</span>
                                  <span>{formatNumber(flow.baseline_rate_per_hour, 1)} → {formatNumber(flow.allowed_rate_per_hour, 1)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-white/60">Cut/hr:</span>
                                  <span>{formatNumber(flow.assigned_cut_per_hour, 1)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-white/60">V:</span>
                                  <span>{formatNumber(flowFeatures.v)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-white/60">S15:</span>
                                  <span>{formatNumber(flowFeatures.slack15)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-white/60">S30:</span>
                                  <span>{formatNumber(flowFeatures.slack30)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-white/60">Flights:</span>
                                  <span>{flowFeatures.flights}</span>
                                </div>
                              </div>
                              <div className="mt-3 flex justify-end">
                                <div className="relative inline-block text-[11px]">
                                  <button
                                    type="button"
                                    className="px-2 py-1 rounded-md border border-white/20 bg-white/10 text-white/90 hover:bg-white/15"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenAddMenuFor(flowMenuOpen ? null : flowMenuKey);
                                    }}
                                    aria-label={`Add flow ${flow.flow_id} from ${proposal.id} to Flow Basket`}
                                    title="Add flow to Flow Basket"
                                  >
                                    + Add
                                  </button>
                                  {flowMenuOpen && (
                                    <div
                                      className="absolute right-0 mt-1 w-44 bg-slate-900/95 border border-white/20 rounded-md shadow-lg z-30"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        className="w-full text-left px-3 py-2 hover:bg-white/10"
                                        onClick={() => {
                                          addFlowFromProposal(proposal, flow);
                                          setOpenAddMenuFor(null);
                                        }}
                                      >
                                        Add
                                      </button>
                                      <button
                                        className="w-full text-left px-3 py-2 hover:bg-white/10"
                                        onClick={() => {
                                          const items = buildBasketItemsFromFlow(flow);
                                          if (items.length === 0) {
                                            setOpenAddMenuFor(null);
                                            return;
                                          }
                                          setReviewContext({ type: "flow", proposal, flow });
                                          setOpenAddMenuFor(null);
                                        }}
                                      >
                                        Review and Add
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            {renderFlightList(proposal.id, flow)}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {(proposal.diagnostics || Object.keys(proposalResults?.weights || {}).length > 0) && (
                    <details className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <summary className="cursor-pointer text-white/80">Weights & Diagnostics</summary>
                      <div className="mt-2 space-y-3 text-[11px] text-white/70">
                        {proposalResults?.weights && (
                          <div>
                            <div className="font-semibold text-white/80">Weights</div>
                            <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-2">
                              {Object.entries(proposalResults.weights).map(([k, v]) => (
                                <div key={k} className="flex justify-between">
                                  <span>{k}</span>
                                  <span>{formatNumber(v)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {proposal.diagnostics && (
                          <div>
                            <div className="font-semibold text-white/80">Diagnostics</div>
                            <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-2">
                              {Object.entries(proposal.diagnostics).map(([k, v]) => (
                                <div key={k} className="flex justify-between">
                                  <span>{k}</span>
                                  <span>{formatNumber(v)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                  <div className="pt-3 border-t border-white/10 flex justify-end gap-2">
                    <button
                      type="button"
                      className={`h-8 w-8 rounded-md border flex items-center justify-center transition-colors ${hasProposalFlights
                        ? 'border-white/20 bg-white/10 text-white/80 hover:bg-white/15'
                        : 'cursor-not-allowed border-white/10 bg-white/5 text-white/40'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!hasProposalFlights) return;
                        setStatsDialog({ flightIds: proposalFlights, fullScreen: true });
                      }}
                      aria-label={`View flight statistics for proposal ${proposal.id}`}
                      title="Flight statistics"
                      disabled={!hasProposalFlights}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M16.3891 8.11096L8.61091 15.8891" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M16.3891 8.11096L16.7426 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M16.3891 8.11096L12.5 7.75741" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    <div className="relative inline-block text-[11px]">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-md border border-white/20 bg-white/10 text-white/90 hover:bg-white/15"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenAddMenuFor(proposalMenuOpen ? null : proposalMenuKey);
                        }}
                        aria-label={`Add proposed regulation ${proposal.id} to Flow Basket`}
                        title="Add all flows from this regulation to Flow Basket"
                      >
                        + Add
                      </button>
                      {proposalMenuOpen && (
                        <div
                          className="absolute right-0 mt-1 w-48 bg-slate-900/95 border border-white/20 rounded-md shadow-lg z-30"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="w-full text-left px-3 py-2 hover:bg-white/10"
                            onClick={() => {
                              addEntireProposalToBasket(proposal);
                              setOpenAddMenuFor(null);
                            }}
                          >
                            Add
                          </button>
                          <button
                            className="w-full text-left px-3 py-2 hover:bg-white/10"
                            onClick={() => {
                              if (!hasProposalFlights) {
                                setOpenAddMenuFor(null);
                                return;
                              }
                              setReviewContext({ type: "proposal", proposal });
                              setOpenAddMenuFor(null);
                            }}
                          >
                            Review and Add
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <FlightQueryDialog
        open={!!reviewContext}
        onClose={handleCloseReview}
        flightIds={reviewFlightIds}
        onSelectFlights={handleReviewSelection}
        highlightLabel={reviewLabels.highlight}
        baselineLabel={reviewLabels.baseline}
        fullScreen
      />
      {statsDialog && typeof window !== "undefined" && createPortal(
        <FlightStatisticsDialog
          open={!!statsDialog}
          onClose={() => setStatsDialog(null)}
          flightIds={statsDialog.flightIds}
          fullScreen={statsDialog.fullScreen ?? true}
        />,
        document.body
      )}
    </div>
  );
}
