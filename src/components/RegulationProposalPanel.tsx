"use client";

import { useEffect, useMemo, useState } from "react";
import ShimmeringText from "@/components/ShimmeringText";
import { useSimStore } from "@/components/useSimStore";
import {
  RegulationProposal,
  collectProposalFlights,
  ProposalFlow,
} from "@/lib/regulationProposals";

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
    togglePreviewAllProposals,
    toggleProposalEye,
    toggleProposalFlowEye,
    setProposalPreview,
    clearProposalPreview,
    fetchRegulationProposals,
    resetProposalState,
  } = useSimStore();

  const [topKInput, setTopKInput] = useState<string>("");
  const [topKError, setTopKError] = useState<string | null>(null);
  const [expandedProposals, setExpandedProposals] = useState<Record<string, boolean>>({});
  const [expandedFlightLists, setExpandedFlightLists] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const nextTopK = proposalQuery?.topK ?? proposalResults?.top_k;
    setTopKInput(nextTopK != null ? String(nextTopK) : "");
    setTopKError(null);
    setExpandedProposals({});
    setExpandedFlightLists({});
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

  if (!showPanel) {
    return null;
  }

  const containerClass = embedded
    ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
    : "absolute top-20 right-4 z-40 w-[420px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col";

  const proposals = proposalResults?.proposals || [];

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

  const renderFlightList = (proposalId: string, flow: ProposalFlow) => {
    const key = `${proposalId}::${flow.flow_id}`;
    const expanded = expandedFlightLists[key] ?? false;
    const flights = flow.flight_ids || [];
    const slice = expanded ? flights : flights.slice(0, 30);
    if (flights.length === 0) {
      return <div className="text-xs text-white/60">No flights listed</div>;
    }
    return (
      <div className="mt-2 space-y-2">
        <table className="w-full text-[11px] text-white/80">
          <tbody>
            {slice.map((flightId) => (
              <tr key={flightId} className="border-b border-white/10 last:border-0">
                <td className="py-1 font-mono">{flightId}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {flights.length > 30 && (
          <button
            onClick={() =>
              setExpandedFlightLists((prev) => ({ ...prev, [key]: !expanded }))
            }
            type="button"
            className="text-xs text-blue-200 hover:text-blue-100 underline"
          >
            {expanded ? "Show less" : `See more (${flights.length - 30} more)`}
          </button>
        )}
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
          <button
            aria-label="Close regulation proposal panel"
            type="button"
            onClick={resetProposalState}
            title="Close panel"
            className="h-7 w-7 flex items-center justify-center rounded-lg border border-white/30 bg-white/10 text-white/80 hover:bg-white/15 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18"></path>
              <path d="M6 6l12 12"></path>
            </svg>
          </button>
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

        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-2">
            <span className="opacity-70">Top K override</span>
            <input
              type="number"
              min={1}
              className="w-20 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-right text-white focus:outline-none"
              value={topKInput}
              onChange={(e) => {
                setTopKInput(e.target.value);
              }}
              placeholder={proposalResults?.top_k ? String(proposalResults.top_k) : ""}
            />
          </label>
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
          const objectiveIconRotation = objectivePositive ? "" : "rotate-180";
          const isPinned = proposalPreviewAll || proposalPinnedProposals.has(proposal.id);
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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedFlightLists((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
                                    }}
                                    type="button"
                                    aria-label={expandedFlightLists[key] ? 'Hide flight list' : 'Show flight list'}
                                    className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${expandedFlightLists[key]
                                      ? 'border-blue-400 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                                      : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
                                    title={expandedFlightLists[key] ? 'Hide flight list' : 'Show flight list'}
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
                            </div>
                            {expandedFlightLists[key] && renderFlightList(proposal.id, flow)}
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
