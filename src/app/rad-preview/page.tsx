"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import BottomControlsGroup from "@/components/BottomControlsGroup";
import Header from "@/components/Header";
import RadAirspaceInfo from "@/components/RadAirspaceInfo";
import RadPreviewCanvas from "@/components/RadPreviewCanvas";
import RadPreviewDcbPanel from "@/components/RadPreviewDcbPanel";
import RadPreviewFlightListPanel from "@/components/RadPreviewFlightListPanel";
import RadPreviewRuleBrowserPanel from "@/components/RadPreviewRuleBrowserPanel";
import RadPreviewRuleDetailsPanel from "@/components/RadPreviewRuleDetailsPanel";
import SidePanelToggleButton from "@/components/SidePanelToggleButton";
import StateResetOnPageLoad from "@/components/StateResetOnPageLoad";
import { useResourceDateGuard } from "@/components/useResourceDateGuard";
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import {
  buildRadFlightCacheKey,
  fetchPreviewRadFlightList,
  fetchPreviewRads,
  fetchPreviewRadsForTrafficVolume,
  fetchPreviewRadsSearch,
  filterRadPreviewRowsLocally,
  mapRadFlightRows,
  normalizeRadId,
  RAD_PREVIEW_SEARCH_FIELDS,
  resolveRadHighlightFlightIds,
  type PreviewRadFlightListResponse,
  type PreviewRadsForTrafficVolumeResponse,
  type PreviewRadsResponse,
  type RadLegitimacyFlag,
  type RadPreviewSearchField,
  type RadPreviewSortMode,
} from "@/lib/radPreview";
import {
  areStringSetsEqual,
  collectTvFlightIdsInWindow,
  formatTvFlightsReferenceTime,
  getTvScopeWindowSeconds,
  intersectOrderedFlightIds,
  normalizeTvFlightsPayload,
  type TvFlightsPayload,
} from "@/lib/radPreviewTvScope";

const RAD_SEARCH_DEBOUNCE_MS = 250;
const TV_RELEVANT_RAD_LIMIT = 250;

export default function RadPreviewPage() {
  const flights = useSimStore((state) => state.flights);
  const t = useSimStore((state) => state.t);
  const resourceStateEpoch = useSimStore((state) => state.resourceStateEpoch);
  const selectedTrafficVolume = useSimStore((state) => state.selectedTrafficVolume);
  const selectedTrafficVolumeData = useSimStore((state) => state.selectedTrafficVolumeData);
  const setSelectedTrafficVolume = useSimStore((state) => state.setSelectedTrafficVolume);
  const setFocusMode = useSimStore((state) => state.setFocusMode);
  const setFocusFlightIds = useSimStore((state) => state.setFocusFlightIds);

  const [leftPanelsMinimized, setLeftPanelsMinimized] = useState(false);
  const [rightPanelsMinimized, setRightPanelsMinimized] = useState(false);
  const [radList, setRadList] = useState<PreviewRadsResponse | PreviewRadsForTrafficVolumeResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedRadId, setSelectedRadId] = useState<string | null>(null);
  const [legitimacyFlag, setLegitimacyFlag] = useState<RadLegitimacyFlag>("L");
  const [filterText, setFilterText] = useState("");
  const [searchFields, setSearchFields] = useState<RadPreviewSearchField[]>(() => [...RAD_PREVIEW_SEARCH_FIELDS]);
  const [exactMatch, setExactMatch] = useState(false);
  const [sortMode, setSortMode] = useState<RadPreviewSortMode>("default");
  const [showUnsupportedRules, setShowUnsupportedRules] = useState(true);
  const [selectedFlightList, setSelectedFlightList] = useState<PreviewRadFlightListResponse | null>(null);
  const [flightListLoading, setFlightListLoading] = useState(false);
  const [flightListError, setFlightListError] = useState<string | null>(null);
  const [hoveredFlightId, setHoveredFlightId] = useState<string | null>(null);
  const [interestWindowLength, setInterestWindowLength] = useState("1h");
  const [tvFlightPayload, setTvFlightPayload] = useState<TvFlightsPayload | null>(null);
  const [tvFlightLoading, setTvFlightLoading] = useState(false);
  const [tvFlightError, setTvFlightError] = useState<string | null>(null);
  const [tvScopedSearchRows, setTvScopedSearchRows] = useState<PreviewRadsResponse["items"] | null>(null);

  const flightCacheRef = useRef<Map<string, PreviewRadFlightListResponse>>(new Map());
  const tvFlightCacheRef = useRef<Map<string, TvFlightsPayload>>(new Map());
  const radListRequestSeq = useRef(0);
  const flightListRequestSeq = useRef(0);
  const tvFlightRequestSeq = useRef(0);
  const previousSelectedTvIdRef = useRef<string | null>(null);
  const { hydrated, ready, resourceDate, user } = useResourceDateGuard();

  useEffect(() => {
    flightCacheRef.current.clear();
    tvFlightCacheRef.current.clear();
    setRadList(null);
    setListLoading(false);
    setListError(null);
    setSelectedRadId(null);
    setLegitimacyFlag("L");
    setFilterText("");
    setSearchFields([...RAD_PREVIEW_SEARCH_FIELDS]);
    setExactMatch(false);
    setSortMode("default");
    setShowUnsupportedRules(true);
    setSelectedFlightList(null);
    setFlightListLoading(false);
    setFlightListError(null);
    setHoveredFlightId(null);
    setInterestWindowLength("1h");
    setTvFlightPayload(null);
    setTvFlightLoading(false);
    setTvFlightError(null);
    setTvScopedSearchRows(null);
    previousSelectedTvIdRef.current = null;
  }, [resourceStateEpoch]);

  const selectedTrafficVolumeId = useMemo(() => {
    const normalized = String(selectedTrafficVolume ?? "").trim();
    return normalized || null;
  }, [selectedTrafficVolume]);

  useEffect(() => {
    if (previousSelectedTvIdRef.current === selectedTrafficVolumeId) return;
    previousSelectedTvIdRef.current = selectedTrafficVolumeId;
    setSelectedRadId(null);
    setHoveredFlightId(null);
    setInterestWindowLength("1h");
    setTvScopedSearchRows(null);
  }, [selectedTrafficVolumeId]);

  const normalizedFilterText = filterText.trim();
  const searchActive = normalizedFilterText.length > 0;
  const searchRequest = useMemo(
    () =>
      searchActive
        ? {
            search: normalizedFilterText,
            fields: searchFields,
            exactMatch,
          }
        : null,
    [searchActive, normalizedFilterText, searchFields, exactMatch],
  );
  const currentTvFlightsRefTime = useMemo(() => formatTvFlightsReferenceTime(t), [t]);

  useEffect(() => {
    if (selectedTrafficVolumeId) return;

    let cancelled = false;
    const requestId = ++radListRequestSeq.current;

    const loadList = () => {
      setListLoading(true);
      setListError(null);

      const request = searchRequest ? fetchPreviewRadsSearch(searchRequest) : fetchPreviewRads();

      request
        .then((response) => {
          if (cancelled || requestId !== radListRequestSeq.current) return;
          setRadList(response);
        })
        .catch((error) => {
          if (cancelled || requestId !== radListRequestSeq.current) return;
          setRadList(null);
          setListError(error instanceof Error ? error.message : "Failed to fetch RAD previews");
        })
        .finally(() => {
          if (cancelled || requestId !== radListRequestSeq.current) return;
          setListLoading(false);
        });
    };

    if (searchRequest) {
      setListLoading(true);
      setListError(null);
      const timeoutId = window.setTimeout(loadList, RAD_SEARCH_DEBOUNCE_MS);
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }

    loadList();

    return () => {
      cancelled = true;
    };
  }, [resourceStateEpoch, searchRequest, selectedTrafficVolumeId]);

  useEffect(() => {
    if (!selectedTrafficVolumeId) return;

    let cancelled = false;
    const requestId = ++radListRequestSeq.current;
    setRadList(null);
    setListLoading(true);
    setListError(null);

    fetchPreviewRadsForTrafficVolume({
      trafficVolumeId: selectedTrafficVolumeId,
      limit: TV_RELEVANT_RAD_LIMIT,
    })
      .then((response) => {
        if (cancelled || requestId !== radListRequestSeq.current) return;
        setRadList(response);
      })
      .catch((error) => {
        if (cancelled || requestId !== radListRequestSeq.current) return;
        setRadList(null);
        setListError(
          error instanceof Error ? error.message : "Failed to fetch traffic-volume RAD previews",
        );
      })
      .finally(() => {
        if (cancelled || requestId !== radListRequestSeq.current) return;
        setListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resourceStateEpoch, selectedTrafficVolumeId]);

  useEffect(() => {
    if (!selectedTrafficVolumeId || !radList) {
      setTvScopedSearchRows(null);
      return;
    }

    if (!searchRequest) {
      setTvScopedSearchRows(null);
      return;
    }

    setTvScopedSearchRows((current) => {
      const sourceRows = current ?? radList.items;
      return filterRadPreviewRowsLocally(sourceRows, searchRequest);
    });
  }, [radList, searchRequest, selectedTrafficVolumeId]);

  const displayedRadRows = useMemo(() => {
    const baseRows = selectedTrafficVolumeId ? tvScopedSearchRows ?? radList?.items ?? [] : radList?.items ?? [];
    const supportedRows = showUnsupportedRules
      ? baseRows
      : baseRows.filter((row) => String(row.support_status ?? "").toLowerCase() !== "unsupported");

    if (sortMode === "default") {
      return supportedRows;
    }

    const sortedRows = [...supportedRows];
    sortedRows.sort((left, right) => {
      const leftCount = Number(left.flight_counts?.[sortMode] ?? 0);
      const rightCount = Number(right.flight_counts?.[sortMode] ?? 0);
      if (rightCount !== leftCount) return rightCount - leftCount;

      const leftSupported = Number(left.supported_instance_count ?? 0);
      const rightSupported = Number(right.supported_instance_count ?? 0);
      if (rightSupported !== leftSupported) return rightSupported - leftSupported;

      return String(left.rad_id ?? "").localeCompare(String(right.rad_id ?? ""));
    });
    return sortedRows;
  }, [radList, selectedTrafficVolumeId, showUnsupportedRules, sortMode, tvScopedSearchRows]);

  useEffect(() => {
    if (!displayedRadRows.length) {
      setSelectedRadId(null);
      return;
    }

    const currentNormalized = normalizeRadId(selectedRadId);
    const stillExists = displayedRadRows.some((row) => normalizeRadId(row.rad_id) === currentNormalized);
    if (stillExists) return;
    setSelectedRadId(null);
  }, [displayedRadRows, selectedRadId]);

  useEffect(() => {
    const normalizedRadId = String(selectedRadId ?? "").trim();
    if (!normalizedRadId) {
      setSelectedFlightList(null);
      setFlightListLoading(false);
      setFlightListError(null);
      setHoveredFlightId(null);
      return;
    }

    const cacheKey = buildRadFlightCacheKey(resourceStateEpoch, normalizedRadId, legitimacyFlag);
    const cached = flightCacheRef.current.get(cacheKey);
    if (cached) {
      setSelectedFlightList(cached);
      setFlightListLoading(false);
      setFlightListError(null);
      setHoveredFlightId(null);
      return;
    }

    let cancelled = false;
    const requestId = ++flightListRequestSeq.current;
    setSelectedFlightList(null);
    setFlightListLoading(true);
    setFlightListError(null);
    setHoveredFlightId(null);

    fetchPreviewRadFlightList(normalizedRadId, legitimacyFlag)
      .then((response) => {
        if (cancelled || requestId !== flightListRequestSeq.current) return;
        flightCacheRef.current.set(cacheKey, response);
        setSelectedFlightList(response);
      })
      .catch((error) => {
        if (cancelled || requestId !== flightListRequestSeq.current) return;
        setSelectedFlightList(null);
        setFlightListError(error instanceof Error ? error.message : "Failed to fetch RAD flight list");
      })
      .finally(() => {
        if (cancelled || requestId !== flightListRequestSeq.current) return;
        setFlightListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [legitimacyFlag, resourceStateEpoch, selectedRadId]);

  useEffect(() => {
    if (!selectedTrafficVolumeId) {
      setTvFlightPayload(null);
      setTvFlightLoading(false);
      setTvFlightError(null);
      return;
    }

    const cacheKey = `${Math.max(0, Math.floor(resourceStateEpoch || 0))}|${selectedTrafficVolumeId}|${currentTvFlightsRefTime}`;
    const cached = tvFlightCacheRef.current.get(cacheKey);
    if (cached) {
      setTvFlightPayload(cached);
      setTvFlightLoading(false);
      setTvFlightError(null);
      return;
    }

    let cancelled = false;
    const requestId = ++tvFlightRequestSeq.current;
    setTvFlightPayload(null);
    setTvFlightLoading(true);
    setTvFlightError(null);

    authFetch(
      `/api/tv_flights?traffic_volume_id=${encodeURIComponent(selectedTrafficVolumeId)}&ref_time_str=${encodeURIComponent(currentTvFlightsRefTime)}`,
    )
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(payload.error || `Failed to fetch traffic volume flights (${response.statusText})`);
        }
        return response.json();
      })
      .then((payload) => {
        if (cancelled || requestId !== tvFlightRequestSeq.current) return;
        const normalizedPayload = normalizeTvFlightsPayload(payload);
        tvFlightCacheRef.current.set(cacheKey, normalizedPayload);
        setTvFlightPayload(normalizedPayload);
      })
      .catch((error) => {
        if (cancelled || requestId !== tvFlightRequestSeq.current) return;
        setTvFlightPayload(null);
        setTvFlightError(
          error instanceof Error ? error.message : "Failed to fetch traffic volume flights",
        );
      })
      .finally(() => {
        if (cancelled || requestId !== tvFlightRequestSeq.current) return;
        setTvFlightLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentTvFlightsRefTime, resourceStateEpoch, selectedTrafficVolumeId]);

  const selectedRow = useMemo(() => {
    const normalized = normalizeRadId(selectedRadId);
    if (!normalized) return null;
    return displayedRadRows.find((row) => normalizeRadId(row.rad_id) === normalized) ?? null;
  }, [displayedRadRows, selectedRadId]);

  const windowSeconds = useMemo(
    () => getTvScopeWindowSeconds(interestWindowLength),
    [interestWindowLength],
  );
  const tvScopedFlightIds = useMemo(() => {
    if (!selectedTrafficVolumeId) return [] as string[];
    return collectTvFlightIdsInWindow(tvFlightPayload, t, windowSeconds);
  }, [selectedTrafficVolumeId, tvFlightPayload, t, windowSeconds]);
  const tvScopedFlightIdSet = useMemo(() => new Set(tvScopedFlightIds), [tvScopedFlightIds]);
  const radScopedFlightIds = useMemo(() => {
    if (!selectedTrafficVolumeId || !selectedRow) return [] as string[];
    return intersectOrderedFlightIds(tvScopedFlightIds, selectedFlightList?.flight_ids ?? []);
  }, [selectedFlightList, selectedRow, selectedTrafficVolumeId, tvScopedFlightIds]);

  useEffect(() => {
    if (!selectedTrafficVolumeId) {
      const state = useSimStore.getState();
      if (state.focusMode || state.focusFlightIds.size > 0) {
        setFocusMode(false);
        setFocusFlightIds(new Set());
      }
      return;
    }

    const state = useSimStore.getState();
    if (!state.focusMode) {
      setFocusMode(true);
    }
    if (!areStringSetsEqual(state.focusFlightIds, tvScopedFlightIdSet)) {
      setFocusFlightIds(tvScopedFlightIdSet);
    }
  }, [selectedTrafficVolumeId, setFocusFlightIds, setFocusMode, tvScopedFlightIdSet]);

  const canvasSelectedFlightIds = useMemo(
    () => resolveRadHighlightFlightIds(selectedRadId, legitimacyFlag, selectedFlightList),
    [legitimacyFlag, selectedFlightList, selectedRadId],
  );

  const displayFlightIds = useMemo(() => {
    if (!selectedTrafficVolumeId) {
      return selectedFlightList?.flight_ids ?? [];
    }
    if (!selectedRow) {
      return tvScopedFlightIds;
    }
    return radScopedFlightIds;
  }, [radScopedFlightIds, selectedFlightList, selectedRow, selectedTrafficVolumeId, tvScopedFlightIds]);

  const tvArrivalTimeByFlightId = useMemo(() => {
    const arrivalTimes = new Map<string, string>();
    if (!selectedTrafficVolumeId || tvFlightPayload?.kind !== "ordered") {
      return arrivalTimes;
    }

    for (const detail of tvFlightPayload.data.details ?? []) {
      const flightId = String(detail?.flight_id ?? "").trim();
      const arrivalTime = String(detail?.arrival_time ?? "").trim();
      if (!flightId || !arrivalTime || arrivalTimes.has(flightId)) continue;
      arrivalTimes.set(flightId, arrivalTime);
    }

    return arrivalTimes;
  }, [selectedTrafficVolumeId, tvFlightPayload]);

  const flightRows = useMemo(() => mapRadFlightRows(displayFlightIds, flights), [displayFlightIds, flights]);

  const flightPanelLoading = selectedTrafficVolumeId
    ? tvFlightLoading || (!!selectedRow && flightListLoading)
    : flightListLoading;
  const flightPanelError = selectedTrafficVolumeId ? tvFlightError || flightListError : flightListError;
  const flightPanelSubtitle = useMemo(() => {
    if (selectedTrafficVolumeId && selectedRow) {
      return `${selectedRow.rad_id} in ${selectedTrafficVolumeId} · focus ${interestWindowLength} · flag ${legitimacyFlag}`;
    }
    if (selectedTrafficVolumeId) {
      return `${selectedTrafficVolumeId} · focus ${interestWindowLength}`;
    }
    if (selectedRow) {
      return `${selectedRow.rad_id} · flag ${legitimacyFlag}`;
    }
    return "Select a RAD to preview flights";
  }, [interestWindowLength, legitimacyFlag, selectedRow, selectedTrafficVolumeId]);
  const flightPanelEmptyMessage = selectedTrafficVolumeId
    ? selectedRow
      ? "No flights matched this RAD within the selected traffic-volume focus window."
      : "No flights matched this traffic volume within the selected focus window."
    : undefined;

  const browserTitle = selectedTrafficVolumeId ? "Relevant RAD Rules" : "RAD Rules";
  const browserContextHint = selectedTrafficVolumeId
    ? `${selectedTrafficVolumeId} · geographically relevant rows only${searchActive ? " · filtered locally" : ""}`
    : null;
  const truncatedListWarning =
    selectedTrafficVolumeId && radList?.truncated
      ? `Only the first ${radList.count.toLocaleString("en-US")} of ${radList.total_available.toLocaleString("en-US")} relevant RADs are loaded for this traffic volume.`
      : null;

  const toggleSearchField = (field: RadPreviewSearchField) => {
    setSearchFields((current) => {
      const exists = current.includes(field);
      if (exists && current.length === 1) {
        return current;
      }

      const next = exists ? current.filter((entry) => entry !== field) : [...current, field];
      return RAD_PREVIEW_SEARCH_FIELDS.filter((entry) => next.includes(entry));
    });
  };

  const handleClearTrafficVolumeFocus = () => {
    setSelectedTrafficVolume(null);
    setHoveredFlightId(null);
  };

  if (!hydrated || !ready || !user) {
    return null;
  }

  const pageLevelError = !selectedTrafficVolumeId && !listLoading && !radList && !!listError && !searchActive;

  return (
    <main
      key={resourceDate ?? "no-resource-date"}
      className="relative h-screen w-screen overflow-hidden bg-slate-900"
    >
      <StateResetOnPageLoad />
      <Header />
      <RadPreviewCanvas
        selectedFlightIds={canvasSelectedFlightIds}
        hoveredFlightId={hoveredFlightId}
        legitimacyFlag={legitimacyFlag}
      />

      <SidePanelToggleButton
        side="left"
        minimized={leftPanelsMinimized}
        onToggle={() => setLeftPanelsMinimized((value) => !value)}
        panelGroupLabel="left panels"
      />
      <SidePanelToggleButton
        side="right"
        minimized={rightPanelsMinimized}
        onToggle={() => setRightPanelsMinimized((value) => !value)}
        panelGroupLabel="right panels"
      />

      <div
        data-bottom-controls-blocker="left"
        style={{ transform: leftPanelsMinimized ? "translateX(calc(-100% - 1.5rem))" : "none" }}
        className={`absolute top-0 left-4 z-40 h-screen w-[380px] overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4 pointer-events-none transition-all duration-300 ease-in-out ${
          leftPanelsMinimized ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="pointer-events-auto shrink-0">
          <RadPreviewDcbPanel embedded />
        </div>
        <div className="pointer-events-auto">
          <RadPreviewFlightListPanel
            rows={flightRows}
            selectedRadId={selectedRow?.rad_id ?? null}
            legitimacyFlag={legitimacyFlag}
            sourceTrafficVolumeId={selectedTrafficVolumeId}
            tvArrivalTimeByFlightId={tvArrivalTimeByFlightId}
            subtitle={flightPanelSubtitle}
            emptyMessage={flightPanelEmptyMessage}
            loading={flightPanelLoading}
            error={flightPanelError}
            hoveredFlightId={hoveredFlightId}
            onHoverFlightIdChange={setHoveredFlightId}
          />
        </div>
      </div>

      <div
        data-bottom-controls-blocker="right"
        style={{ transform: rightPanelsMinimized ? "translateX(calc(100% + 1.5rem))" : "none" }}
        className={`absolute top-0 right-4 z-40 flex h-screen gap-4 transition-all duration-300 ease-in-out ${
          rightPanelsMinimized ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="pointer-events-none h-screen w-[360px] overflow-y-auto no-scrollbar flex flex-col gap-4 pt-16 pb-4">
          {selectedTrafficVolumeId && (
            <div className="pointer-events-auto shrink-0">
              <RadAirspaceInfo
                trafficVolumeId={selectedTrafficVolumeId}
                trafficVolumeData={selectedTrafficVolumeData}
                interestWindowLength={interestWindowLength}
                onInterestWindowLengthChange={setInterestWindowLength}
                onClear={handleClearTrafficVolumeFocus}
              />
            </div>
          )}
          <div className="pointer-events-auto">
            <RadPreviewRuleBrowserPanel
              rows={displayedRadRows}
              selectedRadId={selectedRow?.rad_id ?? null}
              legitimacyFlag={legitimacyFlag}
              title={browserTitle}
              contextHint={browserContextHint}
              warning={truncatedListWarning}
              emptyMessage={
                selectedTrafficVolumeId
                  ? "No geographically relevant RAD rows are available for this traffic volume."
                  : undefined
              }
              filterText={filterText}
              onFilterTextChange={setFilterText}
              searchFields={searchFields}
              onToggleSearchField={toggleSearchField}
              exactMatch={exactMatch}
              onExactMatchChange={setExactMatch}
              sortMode={sortMode}
              onSortModeChange={setSortMode}
              showUnsupportedRules={showUnsupportedRules}
              onShowUnsupportedRulesChange={setShowUnsupportedRules}
              onSelectRadId={setSelectedRadId}
              onLegitimacyFlagChange={setLegitimacyFlag}
              loading={listLoading}
              querying={!selectedTrafficVolumeId && listLoading && searchActive}
              searchActive={searchActive}
              error={listError}
              totalAvailable={radList?.total_available ?? displayedRadRows.length}
            />
          </div>
        </div>
        {selectedRow && (
          <div className="pointer-events-none h-screen w-[420px] overflow-y-auto no-scrollbar flex flex-col pt-16 pb-4">
            <div className="pointer-events-auto">
              <RadPreviewRuleDetailsPanel
                selectedRow={selectedRow}
                selectedFlightList={selectedFlightList}
                legitimacyFlag={legitimacyFlag}
                loading={flightListLoading}
                error={flightListError}
                onClose={() => setSelectedRadId(null)}
              />
            </div>
          </div>
        )}
      </div>

      {pageLevelError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center px-6 pt-16 pointer-events-none">
          <div className="max-w-lg rounded-2xl border border-red-300/30 bg-slate-950/70 p-6 text-white shadow-xl backdrop-blur-md pointer-events-auto">
            <h2 className="text-lg font-semibold">RAD preview is unavailable for this resource state.</h2>
            <p className="mt-3 text-sm text-white/75">{listError}</p>
          </div>
        </div>
      )}

      <BottomControlsGroup showAirspaceDisplayToggle />
    </main>
  );
}
