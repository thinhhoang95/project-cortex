"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import CSComplexityPanel from "@/components/CSComplexityPanel";
import ComplexityBottomControls from "@/components/ComplexityBottomControls";
import ComplexityCanvas from "@/components/ComplexityCanvas";
import Header from "@/components/Header";
import SidePanelToggleButton from "@/components/SidePanelToggleButton";
import { useResourceDateGuard } from "@/components/useResourceDateGuard";
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import {
  buildCollapsedSectorDdSuitePath,
  buildCollapsedSectorDdTracePath,
  buildComplexityOverlayCollections,
  buildForwardTimeRange,
  createEmptyComplexityOverlayCollections,
  mergeTraceEnvelopes,
  type ComplexityMetricId,
  type ComplexitySuiteResponse,
  type ComplexityTraceResponse,
} from "@/lib/csComplexity";

const DEFAULT_INTEREST_WINDOW = "1h";
const DEFAULT_SELECTED_METRIC: ComplexityMetricId = "td";
const DEFAULT_SAMPLE_SECONDS = 120;
const DEFAULT_MAX_TRACE_RECORDS = 200;

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const value =
    (payload as Record<string, unknown>).error ??
    (payload as Record<string, unknown>).detail ??
    (payload as Record<string, unknown>).message;
  return typeof value === "string" && value.trim() ? value : fallback;
}

export default function ComplexityPage() {
  const selectedCollapsedSector = useSimStore((state) => state.selectedCollapsedSector);
  const selectedTrafficVolume = useSimStore((state) => state.selectedTrafficVolume);
  const selectedTrafficVolumes = useSimStore((state) => state.selectedTrafficVolumes);
  const resourceStateEpoch = useSimStore((state) => state.resourceStateEpoch);
  const t = useSimStore((state) => state.t);
  const flLowerBound = useSimStore((state) => state.flLowerBound);
  const flUpperBound = useSimStore((state) => state.flUpperBound);
  const airspaceDisplayMode = useSimStore((state) => state.airspaceDisplayMode);
  const clearSelectedTrafficVolumes = useSimStore((state) => state.clearSelectedTrafficVolumes);
  const setAirspaceDisplayMode = useSimStore((state) => state.setAirspaceDisplayMode);
  const setSelectedCollapsedSector = useSimStore((state) => state.setSelectedCollapsedSector);
  const setFocusMode = useSimStore((state) => state.setFocusMode);
  const setFocusFlightIds = useSimStore((state) => state.setFocusFlightIds);

  const [interestWindowLength, setInterestWindowLength] = useState(DEFAULT_INTEREST_WINDOW);
  const [selectedMetric, setSelectedMetric] = useState<ComplexityMetricId>(DEFAULT_SELECTED_METRIC);
  const [suiteData, setSuiteData] = useState<ComplexitySuiteResponse | null>(null);
  const [suiteLoading, setSuiteLoading] = useState(false);
  const [suiteError, setSuiteError] = useState<string | null>(null);
  const [traceData, setTraceData] = useState<ComplexityTraceResponse | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [rightPanelsMinimized, setRightPanelsMinimized] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);

  const suiteRequestSeq = useRef(0);
  const traceRequestSeq = useRef(0);
  const { hydrated, ready, user } = useResourceDateGuard();

  const timeRange = useMemo(
    () => buildForwardTimeRange(t, interestWindowLength),
    [interestWindowLength, t],
  );

  useEffect(() => {
    setFocusMode(false);
    setFocusFlightIds(new Set<string>());
  }, [setFocusFlightIds, setFocusMode]);

  useEffect(() => {
    if (airspaceDisplayMode !== "es") {
      setAirspaceDisplayMode("es");
    }
    if (selectedTrafficVolume || selectedTrafficVolumes.length > 0) {
      clearSelectedTrafficVolumes();
    }
  }, [
    airspaceDisplayMode,
    clearSelectedTrafficVolumes,
    selectedTrafficVolume,
    selectedTrafficVolumes.length,
    setAirspaceDisplayMode,
  ]);

  useEffect(() => {
    if (selectedCollapsedSector) {
      setPanelVisible(true);
      setRightPanelsMinimized(false);
    }
  }, [selectedCollapsedSector]);

  useEffect(() => {
    if (!selectedCollapsedSector) {
      setSuiteData(null);
      setSuiteError(null);
      setSuiteLoading(false);
      setTraceData(null);
      setTraceError(null);
      setTraceLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++suiteRequestSeq.current;
    setSuiteData(null);
    setSuiteLoading(true);
    setSuiteError(null);

    authFetch(
      buildCollapsedSectorDdSuitePath({
        collapsedSectorId: selectedCollapsedSector,
        timeRange,
        sampleSeconds: DEFAULT_SAMPLE_SECONDS,
      }),
    )
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(extractErrorMessage(payload, "Failed to fetch collapsed sector DD suite"));
        }
        return response.json() as Promise<ComplexitySuiteResponse>;
      })
      .then((payload) => {
        if (cancelled || requestId !== suiteRequestSeq.current) return;
        setSuiteData(payload);
      })
      .catch((error) => {
        if (cancelled || requestId !== suiteRequestSeq.current) return;
        setSuiteData(null);
        setSuiteError(error instanceof Error ? error.message : "Failed to fetch collapsed sector DD suite");
      })
      .finally(() => {
        if (cancelled || requestId !== suiteRequestSeq.current) return;
        setSuiteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resourceStateEpoch, selectedCollapsedSector, timeRange]);

  useEffect(() => {
    if (!selectedCollapsedSector) {
      setTraceData(null);
      setTraceError(null);
      setTraceLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++traceRequestSeq.current;
    setTraceData(null);
    setTraceLoading(true);
    setTraceError(null);

    authFetch(
      buildCollapsedSectorDdTracePath({
        collapsedSectorId: selectedCollapsedSector,
        timeRange,
        metrics: [selectedMetric],
        sampleSeconds: DEFAULT_SAMPLE_SECONDS,
        maxRecordsPerMetric: DEFAULT_MAX_TRACE_RECORDS,
      }),
    )
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(extractErrorMessage(payload, "Failed to fetch collapsed sector DD trace"));
        }
        return response.json() as Promise<ComplexityTraceResponse>;
      })
      .then((payload) => {
        if (cancelled || requestId !== traceRequestSeq.current) return;
        setTraceData(payload);
      })
      .catch((error) => {
        if (cancelled || requestId !== traceRequestSeq.current) return;
        setTraceData(null);
        setTraceError(error instanceof Error ? error.message : "Failed to fetch collapsed sector DD trace");
      })
      .finally(() => {
        if (cancelled || requestId !== traceRequestSeq.current) return;
        setTraceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resourceStateEpoch, selectedCollapsedSector, selectedMetric, timeRange]);

  const mergedTraceEnvelope = useMemo(
    () => mergeTraceEnvelopes(traceData?.snapshots, selectedMetric),
    [selectedMetric, traceData?.snapshots],
  );
  const overlay = useMemo(
    () =>
      selectedCollapsedSector
        ? buildComplexityOverlayCollections({
            metricId: selectedMetric,
            envelope: mergedTraceEnvelope,
            flLowerBound,
            flUpperBound,
          })
        : createEmptyComplexityOverlayCollections(),
    [flLowerBound, flUpperBound, mergedTraceEnvelope, selectedCollapsedSector, selectedMetric],
  );

  const handleClear = () => {
    setPanelVisible(false);
    setSelectedMetric(DEFAULT_SELECTED_METRIC);
    setSelectedCollapsedSector(null);
    setFocusMode(false);
    setFocusFlightIds(new Set<string>());
    setSuiteData(null);
    setTraceData(null);
    setSuiteError(null);
    setTraceError(null);
  };

  if (!hydrated || !ready || !user) {
    return null;
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-900 relative">
      <Header />
      <ComplexityCanvas overlay={overlay} />

      {panelVisible && (
        <>
          <SidePanelToggleButton
            side="right"
            minimized={rightPanelsMinimized}
            onToggle={() => setRightPanelsMinimized((current) => !current)}
            panelGroupLabel="complexity panels"
          />
          <div
            data-bottom-controls-blocker="right"
            style={{ transform: rightPanelsMinimized ? "translateX(calc(100% + 1.5rem))" : "none" }}
            className={`absolute top-0 right-4 z-40 w-[420px] h-screen min-h-0 overflow-y-auto no-scrollbar pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${
              rightPanelsMinimized ? "opacity-0" : "opacity-100"
            }`}
          >
            <div className="pointer-events-auto">
              <CSComplexityPanel
                interestWindowLength={interestWindowLength}
                onInterestWindowLengthChange={setInterestWindowLength}
                selectedMetric={selectedMetric}
                onSelectedMetricChange={setSelectedMetric}
                suiteData={suiteData}
                suiteLoading={suiteLoading}
                suiteError={suiteError}
                traceData={traceData}
                traceLoading={traceLoading}
                traceError={traceError}
                onClear={handleClear}
              />
            </div>
          </div>
        </>
      )}

      {!panelVisible && !selectedCollapsedSector && (
        <div className="absolute top-20 right-4 z-30 max-w-sm rounded-2xl border border-white/15 bg-slate-950/55 px-4 py-3 text-sm text-white/80 shadow-xl backdrop-blur-md">
          Select a collapsed sector on the map to inspect its dynamic density complexity.
        </div>
      )}

      <ComplexityBottomControls />
    </main>
  );
}
