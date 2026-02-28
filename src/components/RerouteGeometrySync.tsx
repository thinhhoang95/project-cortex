"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSimStore } from "@/components/useSimStore";
import { computeRerouteProgramAsync, type RerouteMoveDefinition } from "@/lib/rerouteProgram";

export default function RerouteGeometrySync() {
  const computeSeqRef = useRef(0);
  const {
    flights,
    rerouteCommittedMoves,
    rerouteObstacles,
    rerouteFunnels,
    rerouteBaseSelectedFlightIds,
    setRerouteProgramGeometryResult,
    setRerouteDraftMoveGeometryResult,
    setRerouteMoveResultsById,
    setRerouteGeometryComputing,
    setRerouteGeometryError,
  } = useSimStore();

  const draftFlightIds = useMemo(
    () =>
      Array.from(rerouteBaseSelectedFlightIds)
        .map((rawId) => String(rawId ?? "").trim())
        .filter((flightId, index, values) => flightId.length > 0 && values.indexOf(flightId) === index),
    [rerouteBaseSelectedFlightIds],
  );

  useEffect(() => {
    const moves: RerouteMoveDefinition[] = rerouteCommittedMoves.map((move) => ({
      id: move.id,
      flightIds: move.affectedFlightIds,
      obstacles: move.obstacles,
      funnels: move.funnels,
    }));
    const hasDraftGeometry = rerouteObstacles.length > 0 || rerouteFunnels.length > 0;
    const draftMove =
      hasDraftGeometry && draftFlightIds.length > 0
        ? {
            id: "__draft__",
            flightIds: draftFlightIds,
            obstacles: rerouteObstacles,
            funnels: rerouteFunnels,
          }
        : null;

    if (moves.length === 0 && !draftMove) {
      setRerouteProgramGeometryResult(null);
      setRerouteDraftMoveGeometryResult(null);
      setRerouteMoveResultsById({});
      setRerouteGeometryComputing(false);
      setRerouteGeometryError(null);
      return;
    }

    const computeSeq = computeSeqRef.current + 1;
    computeSeqRef.current = computeSeq;
    const controller = new AbortController();
    setRerouteGeometryComputing(true);
    setRerouteGeometryError(null);

    const timeoutId = window.setTimeout(() => {
      void computeRerouteProgramAsync(
        {
          trajectories: flights,
          moves,
          draftMove,
        },
        {
          signal: controller.signal,
          batchSize: 8,
          maxBlockingMs: 10,
        },
      )
        .then((result) => {
          if (controller.signal.aborted || computeSeqRef.current !== computeSeq) return;
          setRerouteProgramGeometryResult(result.programResult);
          setRerouteDraftMoveGeometryResult(result.draftResult);
          setRerouteMoveResultsById(result.moveResultsById);
          setRerouteGeometryComputing(false);
        })
        .catch((error) => {
          if (controller.signal.aborted || computeSeqRef.current !== computeSeq) return;
          console.error("Failed to compute reroute program preview:", error);
          setRerouteProgramGeometryResult(null);
          setRerouteDraftMoveGeometryResult(null);
          setRerouteMoveResultsById({});
          setRerouteGeometryError(error instanceof Error ? error.message : "Failed to compute reroute preview");
          setRerouteGeometryComputing(false);
        });
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    draftFlightIds,
    flights,
    rerouteCommittedMoves,
    rerouteFunnels,
    rerouteObstacles,
    setRerouteDraftMoveGeometryResult,
    setRerouteGeometryComputing,
    setRerouteGeometryError,
    setRerouteMoveResultsById,
    setRerouteProgramGeometryResult,
  ]);

  return null;
}
