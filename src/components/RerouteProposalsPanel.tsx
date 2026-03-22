"use client";

import { useEffect, useMemo, useState } from "react";
import { useSimStore } from "@/components/useSimStore";
import ShimmeringText from "@/components/ShimmeringText";
import {
  buildRerouteImpactScenarioSignature,
  simulateRerouteImpactScenario,
  validateRerouteImpactScenario,
} from "@/lib/rerouteImpact";

type RerouteProposalsPanelProps = {
  embedded?: boolean;
};

export default function RerouteProposalsPanel({ embedded = false }: RerouteProposalsPanelProps) {
  const {
    rerouteCommittedMoves,
    rerouteMoveResultsById,
    rerouteGeometryComputing,
    rerouteGeometryError,
    deleteRerouteMove,
    setRerouteImpactResult,
    setIsRerouteImpactResultsOpen,
    setRerouteImpactScenarioSignature,
  } = useSimStore();
  const [expandedByMoveId, setExpandedByMoveId] = useState<Record<string, boolean>>({});
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const [simulateLoading, setSimulateLoading] = useState(false);

  const panelClassName = embedded
    ? "w-full max-w-[384px] mx-auto rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
    : "absolute top-20 right-4 z-50 min-w-[320px] max-w-[400px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col";

  const moveCards = useMemo(
    () =>
      rerouteCommittedMoves.map((move) => {
        const result = rerouteMoveResultsById[move.id] ?? null;
        const byFlightId = new Map((result?.flights || []).map((flight) => [flight.flightId, flight]));
        return {
          move,
          result,
          byFlightId,
        };
      }),
    [rerouteCommittedMoves, rerouteMoveResultsById],
  );
  const scenarioValidation = useMemo(
    () => validateRerouteImpactScenario(rerouteCommittedMoves),
    [rerouteCommittedMoves],
  );
  const scenarioSignature = useMemo(
    () => buildRerouteImpactScenarioSignature(rerouteCommittedMoves),
    [rerouteCommittedMoves],
  );
  const simulateDisabledReason = !scenarioValidation.canSimulate ? scenarioValidation.reason : null;

  useEffect(() => {
    setSimulateError(null);
  }, [scenarioSignature]);

  const handleSimulate = async () => {
    if (!scenarioValidation.canSimulate || simulateLoading) return;
    const requestSignature = scenarioSignature;
    setSimulateError(null);
    setSimulateLoading(true);

    try {
      const result = await simulateRerouteImpactScenario(rerouteCommittedMoves);
      const latestSignature = buildRerouteImpactScenarioSignature(useSimStore.getState().rerouteCommittedMoves);
      if (latestSignature !== requestSignature) {
        return;
      }
      setRerouteImpactResult(result);
      setRerouteImpactScenarioSignature(requestSignature);
      setIsRerouteImpactResultsOpen(true);
    } catch (error) {
      console.error("Failed to simulate reroute impact:", error);
      setSimulateError(error instanceof Error ? error.message : "Failed to simulate reroute impact.");
    } finally {
      setSimulateLoading(false);
    }
  };

  return (
    <div className={panelClassName}>
      <div className="p-4 border-b border-white/20">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Reroute Proposals</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs opacity-70">{rerouteCommittedMoves.length} stored</div>
            <button
              type="button"
              onClick={handleSimulate}
              disabled={!scenarioValidation.canSimulate || simulateLoading}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                scenarioValidation.canSimulate && !simulateLoading
                  ? "border-cyan-300/50 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30"
                  : "cursor-not-allowed border-white/10 bg-white/5 text-white/45"
              }`}
              title={simulateDisabledReason || "Simulate reroute impact"}
            >
              {simulateLoading ? <ShimmeringText text="Simulating..." /> : "Simulate"}
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {simulateDisabledReason ? (
          <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {simulateDisabledReason}
          </div>
        ) : null}

        {simulateError ? (
          <div className="rounded-lg border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-xs text-rose-100">
            {simulateError}
          </div>
        ) : null}

        {rerouteGeometryError ? (
          <div className="rounded-lg border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-xs text-rose-100">
            {rerouteGeometryError}
          </div>
        ) : null}

        {rerouteGeometryComputing ? (
          <div className="rounded-lg border border-cyan-300/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            Recomputing committed reroute program...
          </div>
        ) : null}

        {moveCards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-4 py-5 text-center">
            <div className="text-sm font-medium">No committed reroute moves</div>
            <p className="text-[11px] opacity-70 mt-2">Commit a reroute to get started.</p>
          </div>
        ) : null}

        {moveCards.map(({ move, result, byFlightId }) => {
          const isExpanded = expandedByMoveId[move.id] === true;
          return (
            <div key={move.id} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{move.label}</div>
                  <div className="text-[11px] opacity-65 mt-1">{formatTimestamp(move.createdAtEpochMs)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteRerouteMove(move.id)}
                  className="shrink-0 flex items-center gap-1.5 rounded-md border border-rose-300/40 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-100 transition-colors hover:bg-rose-500/25"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                  Delete
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <MetricChip
                  label="Flights"
                  value={move.affectedFlightIds.length.toString()}
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-.5-.5-2.5 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.6L3 8l6 5-3 3-3-1-2 2 4 4 2-2-1-3 3-3 5 6 1.2-.7c.4-.2.7-.6.6-1.1Z" />
                    </svg>
                  }
                />
                <MetricChip
                  label="Extra NM"
                  value={(result?.totalExtraNm ?? 0).toLocaleString("en-US")}
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
                      <path d="m14.5 12.5 2-2" />
                      <path d="m11.5 9.5 2-2" />
                      <path d="m8.5 6.5 2-2" />
                      <path d="m17.5 15.5 2-2" />
                    </svg>
                  }
                />
                <MetricChip
                  label="Obstacles"
                  value={move.obstacles.length.toString()}
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    </svg>
                  }
                />
                <MetricChip
                  label="Funnels"
                  value={move.funnels.length.toString()}
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                    </svg>
                  }
                />
              </div>

              <button
                type="button"
                onClick={() =>
                  setExpandedByMoveId((current) => ({
                    ...current,
                    [move.id]: !isExpanded,
                  }))
                }
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-[11px] text-white/80 transition-colors hover:bg-white/10"
              >
                {isExpanded ? "Hide affected flights" : `Show affected flights (${move.affectedFlightIds.length})`}
              </button>

              {isExpanded ? (
                <div className="space-y-2">
                  {move.affectedFlightIds.map((flightId) => {
                    const flight = byFlightId.get(flightId);
                    return (
                      <div key={flightId} className="rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-[11px]">
                        <div className="font-mono text-white/95">{flightId}</div>
                        {flight ? (
                          <div className="mt-1 flex items-center justify-between gap-3 text-white/70">
                            <span>{flight.oldSegments.length} old segs</span>
                            <span>{flight.newSegments.length} new segs</span>
                            <span>{flight.extraNm.toLocaleString("en-US")} NM</span>
                          </div>
                        ) : (
                          <div className="mt-1 text-white/55">No current rebased change for this flight.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricChip(props: { label: string; value: string; icon?: React.ReactNode }) {
  const { label, value, icon } = props;
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center gap-2">
      {icon && <div className="text-white/40 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="opacity-60">{label}</div>
        <div className="mt-0.5 text-sm font-medium text-white">{value}</div>
      </div>
    </div>
  );
}

function formatTimestamp(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return "Unknown time";
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
