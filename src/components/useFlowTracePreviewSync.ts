"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSimStore } from "@/components/useSimStore";
import { fetchFlowTrace } from "@/lib/flowTrace";
import {
  deriveFlowTracePreviewFlightIds,
  getFlowTracePreviewKey,
} from "@/lib/flowTracePreview";

export function useFlowTracePreviewSync(): void {
  const flightLinePreviewFlightIds = useSimStore((state) => state.flightLinePreviewFlightIds);
  const flowGroups = useSimStore((state) => state.flowGroups);
  const flowPreviewFlightId = useSimStore((state) => state.flowPreviewFlightId);
  const flowPreviewGroupId = useSimStore((state) => state.flowPreviewGroupId);
  const proposalPreviewActive = useSimStore((state) => state.proposalPreviewActive);
  const proposalPreviewFlightIds = useSimStore((state) => state.proposalPreviewFlightIds);
  const regulationPreviewActive = useSimStore((state) => state.regulationPreviewActive);
  const regulationTargetFlightIds = useSimStore((state) => state.regulationTargetFlightIds);
  const setFlowTraceVolumeIds = useSimStore((state) => state.setFlowTraceVolumeIds);
  const clearFlowTraceVolumeIds = useSimStore((state) => state.clearFlowTraceVolumeIds);
  const setFlowTraceLoading = useSimStore((state) => state.setFlowTraceLoading);
  const setFlowTraceError = useSimStore((state) => state.setFlowTraceError);
  const requestSeqRef = useRef(0);

  const traceFlightIds = useMemo(
    () =>
      deriveFlowTracePreviewFlightIds({
        flightLinePreviewFlightIds,
        flowGroups,
        flowPreviewFlightId,
        flowPreviewGroupId,
        proposalPreviewActive,
        proposalPreviewFlightIds,
        regulationPreviewActive,
        regulationTargetFlightIds,
      }),
    [
      flightLinePreviewFlightIds,
      flowGroups,
      flowPreviewFlightId,
      flowPreviewGroupId,
      proposalPreviewActive,
      proposalPreviewFlightIds,
      regulationPreviewActive,
      regulationTargetFlightIds,
    ],
  );
  const traceKey = useMemo(() => getFlowTracePreviewKey(traceFlightIds), [traceFlightIds]);

  useEffect(() => {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;

    if (!traceKey) {
      clearFlowTraceVolumeIds();
      return;
    }

    setFlowTraceLoading(true);
    setFlowTraceError(null);
    void fetchFlowTrace(traceFlightIds)
      .then((trace) => {
        if (requestSeqRef.current !== seq) return;
        setFlowTraceVolumeIds(trace.volume_ids || []);
        setFlowTraceLoading(false);
      })
      .catch((err) => {
        if (requestSeqRef.current !== seq) return;
        setFlowTraceVolumeIds([]);
        setFlowTraceError(err instanceof Error ? err.message : "Failed to fetch flow trace");
        setFlowTraceLoading(false);
      });

    return () => {
      requestSeqRef.current += 1;
    };
  }, [
    traceKey,
    clearFlowTraceVolumeIds,
    setFlowTraceError,
    setFlowTraceLoading,
    setFlowTraceVolumeIds,
    traceFlightIds,
  ]);

  useEffect(
    () => () => {
      requestSeqRef.current += 1;
      clearFlowTraceVolumeIds();
    },
    [clearFlowTraceVolumeIds],
  );
}
