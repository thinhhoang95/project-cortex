"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { useSimStore } from "@/components/useSimStore";
import { fetchResourceStateBundle, selectResourceState } from "@/lib/resourceContextClient";
import { buildResourceStateSyncPayload } from "@/lib/resourceStates";

function formatMinutes(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

function getStateLabel(label: string | null | undefined, episodeIndex: number): string {
  const trimmed = String(label ?? "").trim();
  if (trimmed) return trimmed;
  return episodeIndex === 0 ? "State Zero" : `Episode ${episodeIndex}`;
}

export default function ResourceStateHistoryControl() {
  const {
    resourceDate,
    resourceStateSelectedId,
    resourceStateHeadId,
    resourceStateZeroId,
    resourceStateStates,
    resourceStatePendingId,
    resourceStateError,
    resourceStateLoading,
    viewOptionsMinimized,
    airspaceDisplayMode,
    selectedTrafficVolume,
    selectedTrafficVolumes,
    syncResourceState,
    setResourceStateLoading,
    setResourceStatePendingId,
    setResourceStateError,
  } = useSimStore();
  const [hoveredStateId, setHoveredStateId] = useState<string | null>(null);

  const selectedTvIds = useMemo(
    () =>
      Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0
        ? selectedTrafficVolumes
        : selectedTrafficVolume
          ? [selectedTrafficVolume]
          : [],
    [selectedTrafficVolume, selectedTrafficVolumes],
  );
  const slackEligible = airspaceDisplayMode === "tv" && selectedTvIds.length === 1;
  const bottomClass = viewOptionsMinimized
    ? slackEligible ? "bottom-28" : "bottom-20"
    : slackEligible ? "bottom-40" : "bottom-32";

  const activeStateId = hoveredStateId ?? resourceStatePendingId ?? resourceStateSelectedId;
  const activeState =
    resourceStateStates.find((state) => state.state_id === activeStateId) ??
    resourceStateStates.find((state) => state.state_id === resourceStateSelectedId) ??
    resourceStateStates[0] ??
    null;

  const refreshFromServer = useCallback(async () => {
    const { context, history } = await fetchResourceStateBundle();
    syncResourceState(buildResourceStateSyncPayload(context, history));
  }, [syncResourceState]);

  const handleStateSelect = useCallback(async (stateId: string) => {
    if (!stateId || stateId === resourceStateSelectedId || stateId === resourceStatePendingId) {
      return;
    }

    setResourceStateError(null);
    setResourceStatePendingId(stateId);
    setResourceStateLoading(true);

    try {
      await selectResourceState(stateId);
      await refreshFromServer();
    } catch (error) {
      console.error("Failed to select resource state:", error);
      try {
        await refreshFromServer();
      } catch (refreshError) {
        console.error("Failed to refresh resource state after selection error:", refreshError);
      }
      setResourceStateError(
        error instanceof Error ? error.message : "Failed to switch resource state",
      );
    } finally {
      setResourceStatePendingId(null);
      setResourceStateLoading(false);
    }
  }, [
    refreshFromServer,
    resourceStatePendingId,
    resourceStateSelectedId,
    setResourceStateError,
    setResourceStateLoading,
    setResourceStatePendingId,
  ]);

  useEffect(() => {
    if (!resourceDate || resourceStateStates.length > 0 || resourceStateLoading || resourceStateError) return;
    void refreshFromServer().catch((error) => {
      console.error("Failed to refresh resource state bundle:", error);
      setResourceStateError(error instanceof Error ? error.message : "Failed to load resource state");
      setResourceStateLoading(false);
    });
  }, [
    refreshFromServer,
    resourceStateError,
    resourceDate,
    resourceStateLoading,
    resourceStateStates.length,
    setResourceStateError,
    setResourceStateLoading,
  ]);

  useEffect(() => {
    if (!resourceStateError) return;
    const timeoutId = window.setTimeout(() => setResourceStateError(null), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [resourceStateError, setResourceStateError]);

  if (!resourceDate) return null;
  if (!resourceStateLoading && resourceStateStates.length === 0 && !resourceStateError) return null;

  return (
    <div className={`fixed left-1/2 z-40 -translate-x-1/2 pointer-events-none ${bottomClass}`}>
      <div className="pointer-events-auto w-[min(92vw,680px)] rounded-2xl border border-cyan-300/20 bg-slate-950/80 px-4 py-3 text-white shadow-2xl backdrop-blur-md sm:min-w-[360px]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/75">Resource State Timeline</div>
          <div className="flex items-center gap-2">
            {resourceStateLoading && (
              <div className="h-2 w-2 rounded-full bg-cyan-300 animate-pulse" aria-hidden="true" />
            )}
            {resourceStateError && (
              <button
                type="button"
                onClick={() => void refreshFromServer().catch(() => undefined)}
                className="rounded-full border border-rose-300/40 bg-rose-300/10 px-2.5 py-1 text-[11px] font-medium text-rose-100 hover:bg-rose-300/15"
              >
                Retry
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto pb-1">
          {resourceStateStates.length > 0 ? (
            <div className="flex min-w-max items-center justify-center">
              {resourceStateStates.map((state, index) => {
                const isSelected = state.state_id === resourceStateSelectedId;
                const isPending = state.state_id === resourceStatePendingId;
                const isHead = state.state_id === resourceStateHeadId;
                const isZero = state.state_id === resourceStateZeroId;
                const tickClass = isPending
                  ? "bg-amber-300"
                  : isSelected
                    ? "bg-cyan-300"
                    : isHead
                      ? "bg-emerald-300"
                      : isZero
                        ? "bg-slate-200/90"
                        : "bg-white/45";
                const connectorClass =
                  isSelected || isPending
                    ? "border-cyan-200/80"
                    : "border-white/20";

                return (
                  <Fragment key={state.state_id}>
                    <button
                      type="button"
                      onClick={() => void handleStateSelect(state.state_id)}
                      onMouseEnter={() => setHoveredStateId(state.state_id)}
                      onMouseLeave={() => setHoveredStateId((current) => current === state.state_id ? null : current)}
                      className="group flex h-10 w-8 items-center justify-center rounded-full transition hover:bg-white/5 disabled:cursor-not-allowed"
                      disabled={isPending}
                      aria-pressed={isSelected}
                      title={`${state.state_id} · ${getStateLabel(state.label, state.episode_index)}`}
                    >
                      <span className={`h-5 w-[3px] rounded-full transition ${tickClass}`} />
                    </button>
                    {index < resourceStateStates.length - 1 && (
                      <div className="flex w-10 items-center justify-center">
                        <div className={`w-full border-t border-dashed ${connectorClass}`} />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          ) : (
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/65">
              Loading state history…
            </div>
          )}
        </div>

        {activeState && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/55">
              <span>{activeState.state_id}</span>
              <span>Episode {activeState.episode_index}</span>
              {activeState.state_id === resourceStateHeadId && (
                <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-emerald-100">
                  Head
                </span>
              )}
              {activeState.state_id === resourceStateZeroId && (
                <span className="rounded-full border border-slate-200/20 bg-slate-200/10 px-2 py-0.5 text-slate-100">
                  Baseline
                </span>
              )}
              {activeState.state_id === resourceStatePendingId && (
                <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-amber-100">
                  Switching
                </span>
              )}
            </div>
            <div className="mt-1 text-sm font-semibold text-white">
              {getStateLabel(activeState.label, activeState.episode_index)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70">
              <span>{formatMinutes(activeState.total_cumulative_delay_minutes)} cumulative min</span>
              <span>{formatMinutes(activeState.total_incremental_delay_minutes)} incremental min</span>
              <span>{Math.round(activeState.num_delayed_flights).toLocaleString()} delayed flights</span>
            </div>
          </div>
        )}

        {resourceStateError && (
          <div className="mt-3 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
            {resourceStateError}
          </div>
        )}
      </div>
    </div>
  );
}
