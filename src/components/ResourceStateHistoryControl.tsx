"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useSimStore } from "@/components/useSimStore";
import { selectResourceState } from "@/lib/resourceContextClient";
import {
  refreshResourceStateFromServer,
  ResourceDateOutOfSyncError,
} from "@/lib/resourceStateSync";

function formatMinutes(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

function getStateLabel(label: string | null | undefined, episodeIndex: number): string {
  const trimmed = String(label ?? "").trim();
  if (trimmed) return trimmed;
  return episodeIndex === 0 ? "State Zero" : `Episode ${episodeIndex}`;
}

type ResourceStateHistoryControlProps = {
  embedded?: boolean;
  className?: string;
};

export default function ResourceStateHistoryControl({
  embedded = false,
  className,
}: ResourceStateHistoryControlProps) {
  const router = useRouter();
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
    clearResourceDate,
    clearResourceState,
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
    ? slackEligible ? "bottom-28" : "bottom-10"
    : slackEligible ? "bottom-40" : "bottom-24";

  const handleResourceDateOutOfSync = useCallback(() => {
    clearResourceState();
    clearResourceDate();
    router.replace("/select-date?reason=out_of_sync");
  }, [clearResourceDate, clearResourceState, router]);

  const refreshFromServer = useCallback(async () => {
    await refreshResourceStateFromServer({
      expectedResourceDate: resourceDate,
      onOutOfSync: () => handleResourceDateOutOfSync(),
      syncResourceState,
    });
  }, [handleResourceDateOutOfSync, resourceDate, syncResourceState]);

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
      if (error instanceof ResourceDateOutOfSyncError) {
        return;
      }
      console.error("Failed to select resource state:", error);
      try {
        await refreshFromServer();
      } catch (refreshError) {
        if (!(refreshError instanceof ResourceDateOutOfSyncError)) {
          console.error("Failed to refresh resource state after selection error:", refreshError);
        }
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
    setResourceStateLoading(true);
    void refreshFromServer().catch((error) => {
      if (error instanceof ResourceDateOutOfSyncError) return;
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

  const containerClassName = embedded
    ? `pointer-events-auto flex items-center ${className ?? ""}`
    : `fixed left-1/2 z-40 -translate-x-1/2 pointer-events-none ${bottomClass} ${className ?? ""}`;

  return (
    <div className={containerClassName}>
      <div className={embedded ? "flex items-center" : "pointer-events-auto flex items-center"}>

        {/* Loading skeleton ticks */}
        {resourceStateLoading && resourceStateStates.length === 0 && (
          <>
            {[0, 1, 2].map((i) => (
              <Fragment key={i}>
                <div className="flex h-8 w-8 items-center justify-center">
                  <div
                    className="h-3 w-[2px] rounded-full bg-white/20 animate-pulse"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                </div>
                {i < 2 && (
                  <div className="flex w-10 items-center justify-evenly">
                    {[0, 1, 2].map((t) => (
                      <div key={t} className="h-1.5 w-px rounded-full bg-white/15" />
                    ))}
                  </div>
                )}
              </Fragment>
            ))}
          </>
        )}

        {/* Ruler ticks */}
        {resourceStateStates.map((state, index) => {
          const isSelected = state.state_id === resourceStateSelectedId;
          const isPending = state.state_id === resourceStatePendingId;
          const isHead = state.state_id === resourceStateHeadId;
          const isZero = state.state_id === resourceStateZeroId;
          const isHovered = state.state_id === hoveredStateId;

          const tickColor = isPending
            ? "bg-amber-300"
            : isSelected
              ? "bg-cyan-300"
              : isHead
                ? "bg-emerald-300"
                : isZero
                  ? "bg-slate-300/70"
                  : "bg-white/35";

          const tickHeight = isHovered || isSelected ? "h-5" : isPending ? "h-4" : "h-3";

          return (
            <Fragment key={state.state_id}>
              <div className="relative flex items-center justify-center w-8">

                {/* Hover tooltip */}
                {isHovered && (
                  <div className="absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 z-50 w-44 rounded-lg border border-white/20 bg-white/10 px-3 py-2 shadow-md backdrop-blur-sm pointer-events-none">
                    <div className="text-[11px] font-medium text-white">
                      {getStateLabel(state.label, state.episode_index)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-gray-300">
                      ep.{state.episode_index} · {state.state_id}
                    </div>
                    <div className="mt-1.5 space-y-0.5 text-[10px] text-gray-300">
                      <div>{formatMinutes(state.total_cumulative_delay_minutes)} cum. min delay</div>
                      <div>{formatMinutes(state.total_incremental_delay_minutes)} incr. min delay</div>
                      <div>{Math.round(state.num_delayed_flights).toLocaleString()} delayed flights</div>
                    </div>
                    {(isHead || isZero || isPending) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {isHead && (
                          <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-1.5 py-px text-[9px] text-emerald-200">
                            Head
                          </span>
                        )}
                        {isZero && (
                          <span className="rounded-full border border-white/20 bg-white/10 px-1.5 py-px text-[9px] text-gray-200">
                            Baseline
                          </span>
                        )}
                        {isPending && (
                          <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-1.5 py-px text-[9px] text-amber-200">
                            Switching…
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Tick button */}
                <button
                  type="button"
                  onClick={() => void handleStateSelect(state.state_id)}
                  onMouseEnter={() => setHoveredStateId(state.state_id)}
                  onMouseLeave={() => setHoveredStateId((current) => current === state.state_id ? null : current)}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-all hover:bg-white/[0.06] disabled:cursor-not-allowed"
                  disabled={isPending}
                  aria-pressed={isSelected}
                  title={`${state.state_id} · ${getStateLabel(state.label, state.episode_index)}`}
                >
                  <span
                    className={`${tickHeight} w-[2px] rounded-full transition-all ${tickColor} ${isPending ? "animate-pulse" : ""}`}
                  />
                </button>
              </div>

              {/* Selected state chip (inline) */}
              {isSelected && (
                <div className="mx-1.5 whitespace-nowrap rounded-full bg-cyan-300 px-2 py-px text-[10px] font-medium text-black">
                  {resourceStateStates.length === 1 && isZero
                    ? "MOVES HISTORY EMPTY"
                    : getStateLabel(state.label, state.episode_index)}
                </div>
              )}

              {/* Connector between ticks */}
              {index < resourceStateStates.length - 1 && (
                <div className="flex w-10 items-center justify-evenly">
                  {[0, 1, 2].map((t) => (
                    <div key={t} className="h-1.5 w-px rounded-full bg-white/20" />
                  ))}
                </div>
              )}
            </Fragment>
          );
        })}

        {/* Error retry */}
        {resourceStateError && (
          <button
            type="button"
            onClick={() => void refreshFromServer().catch(() => undefined)}
            className="ml-2 rounded-full border border-rose-400/30 px-2 py-0.5 text-[10px] text-rose-300/60 transition hover:border-rose-300/40 hover:text-rose-200"
          >
            retry
          </button>
        )}

      </div>
    </div>
  );
}
