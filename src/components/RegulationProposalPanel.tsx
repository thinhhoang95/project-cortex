"use client";

import { useEffect, useMemo, useState } from "react";
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
            className={`px-2 py-1 rounded-lg border text-xs ${proposalPreviewAll
              ? 'border-blue-400 bg-blue-500/20 text-blue-100'
              : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
          >
            👁 Preview All
          </button>
          <button
            aria-label="Re-run regulation proposals"
            disabled={!proposalQuery || proposalLoading || !!topKError}
            type="button"
            onClick={handleRerun}
            className={`px-2 py-1 rounded-lg border text-xs ${proposalLoading
              ? 'border-blue-400/50 bg-blue-500/20 text-blue-100'
              : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
          >
            {proposalLoading ? 'Loading…' : 'Re-run'}
          </button>
          <button
            aria-label="Close regulation proposal panel"
            type="button"
            onClick={resetProposalState}
            className="px-2 py-1 rounded-lg border border-white/30 bg-white/10 text-xs text-white/80 hover:bg-white/15"
          >
            Close
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
          <div className="space-y-3">
            {[...Array(3)].map((_, idx) => (
              <div key={idx} className="h-16 animate-pulse rounded-lg bg-white/10" />
            ))}
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
          const improvement = proposal.objective_improvement || { delta_deficit_per_hour: 0, delta_objective_score: 0 };
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
                    <div className="text-sm font-semibold">{proposal.id}</div>
                    <div className="text-[11px] opacity-70">{proposal.control_window?.label} · ({proposal.flows?.length || 0} flows)</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col text-right text-[11px]">
                      <span>Δ deficit/hr: {formatNumber(improvement.delta_deficit_per_hour)}</span>
                      <span>Δ objective: {formatNumber(improvement.delta_objective_score)}</span>
                    </div>
                    <button
                      aria-label={`Toggle preview for ${proposal.id}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleProposalEye(proposal.id);
                      }}
                      className={`rounded-lg border px-2 py-1 text-xs ${isPinned
                        ? 'border-blue-400 bg-blue-500/20 text-blue-100'
                        : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
                    >
                      👁
                    </button>
                    <button
                      aria-label={`Expand details for ${proposal.id}`}
                      type="button"
                      className="rounded-lg border border-white/30 bg-white/10 px-2 py-1 text-xs text-white/70"
                    >
                      {expanded ? 'Hide' : 'View'}
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
                  <div className="grid gap-1">
                    <div className="font-semibold text-white/80">Objective Components</div>
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="text-white/60">
                          <th className="py-1">Component</th>
                          <th className="py-1">Before</th>
                          <th className="py-1">After</th>
                          <th className="py-1">Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(new Set([
                          ...Object.keys(proposal.objective_components?.before || {}),
                          ...Object.keys(proposal.objective_components?.after || {}),
                          ...Object.keys(proposal.objective_components?.delta || {}),
                        ])).map((key) => (
                          <tr key={key} className="border-t border-white/10">
                            <td className="py-1 font-medium">{key}</td>
                            <td className="py-1">{formatNumber(proposal.objective_components?.before?.[key])}</td>
                            <td className="py-1">{formatNumber(proposal.objective_components?.after?.[key])}</td>
                            <td className="py-1">{formatNumber(proposal.objective_components?.delta?.[key])}</td>
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
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <div className="font-semibold">Flow {flow.flow_id}</div>
                              <div className="text-white/70">{flow.control_volume_id || '—'}</div>
                              <div>
                                {formatNumber(flow.baseline_rate_per_hour, 1)} → {formatNumber(flow.allowed_rate_per_hour, 1)}
                              </div>
                              <div>Cut/hr {formatNumber(flow.assigned_cut_per_hour, 1)}</div>
                              <div>V {formatNumber(flowFeatures.v)}</div>
                              <div>S15 {formatNumber(flowFeatures.slack15)}</div>
                              <div>S30 {formatNumber(flowFeatures.slack30)}</div>
                              <div>N {flowFeatures.flights}</div>
                              <button
                                aria-label={`Toggle preview for flow ${flow.flow_id}`}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleProposalFlowEye(proposal.id, flow.flow_id);
                                }}
                                className={`rounded-lg border px-2 py-1 text-xs ${flowPinned
                                  ? 'border-blue-400 bg-blue-500/20 text-blue-100'
                                  : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
                              >
                                👁
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedFlightLists((prev) => ({ ...prev, [key]: ! (prev[key] ?? false) }));
                                }}
                                type="button"
                                className="rounded-lg border border-white/30 bg-white/10 px-2 py-1 text-xs text-white/70"
                              >
                                {expandedFlightLists[key] ? 'Hide Flights' : 'Flight List'}
                              </button>
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
                            <div className="mt-1 grid grid-cols-2 gap-1">
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
                            <div className="mt-1 grid grid-cols-2 gap-1">
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
