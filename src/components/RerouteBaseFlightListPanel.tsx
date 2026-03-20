"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSimStore } from "@/components/useSimStore";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import { authFetch } from "@/lib/auth";
import { formatDwellingTime } from "@/lib/dwellTime";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";

const MAX_VISIBLE = 24;
const REROUTE_BASE_PREVIEW_GROUP_ID = "reroute-base-flight-list";
const TIME_WINDOW_PRESETS = ["15", "30", "45", "1h", "1h15", "1h30", "1h45", "2h", "2h30", "3h", "3h30", "4h"];

type FlowPreviewSnapshot = Pick<
  ReturnType<typeof useSimStore.getState>,
  "flowCommunities" | "flowGroups" | "flowColorByCommunity" | "flowPreviewGroupId" | "flowPreviewFlightId"
>;

type RerouteBaseFlightListPanelProps = {
  embedded?: boolean;
};

type OrderedFlightsData = {
  traffic_volume_id: string;
  ref_time_str: string;
  ordered_flights: string[];
  details: {
    flight_id: string;
    arrival_time: string;
    arrival_seconds: number;
    delta_seconds: number;
    time_window: string;
    dwell_seconds?: number | null;
  }[];
};

type LegacyFlightsData = Record<string, string[]>;

type TvFlightsPayload =
  | { kind: "ordered"; data: OrderedFlightsData }
  | { kind: "legacy"; data: LegacyFlightsData };

type TvFlightCell = {
  arrivalTime: string;
  dwellSeconds: number | null;
};

export default function RerouteBaseFlightListPanel({ embedded = false }: RerouteBaseFlightListPanelProps) {
  const {
    rerouteBaseFlightIds,
    rerouteBaseSelectedFlightIds,
    clearRerouteBaseFlightIds,
    removeRerouteBaseFlightIds,
    setRerouteBaseSelectedFlightIds,
    flights,
    t,
    resourceStateEpoch,
    regulationTimeWindow,
    airspaceDisplayMode,
    selectedTrafficVolume,
    selectedTrafficVolumes,
    setFlowCommunities,
    setFlowPreviewGroupId,
    setFlowPreviewFlightId,
    setRegulationTimeWindow,
  } = useSimStore();

  const [expanded, setExpanded] = useState(false);
  const [previewSelectedOnly, setPreviewSelectedOnly] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("1h");
  const originalPreviewRef = useRef<FlowPreviewSnapshot | null>(null);
  const tvFlightsReqSeq = useRef(0);
  const [tvFlightDataByTv, setTvFlightDataByTv] = useState<Record<string, TvFlightsPayload>>({});

  useEffect(() => {
    setTvFlightDataByTv({});
    setExpanded(false);
    originalPreviewRef.current = null;
  }, [resourceStateEpoch]);

  const selectedTvIds = useMemo(() => {
    const source =
      Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0
        ? selectedTrafficVolumes
        : selectedTrafficVolume
          ? [selectedTrafficVolume]
          : [];

    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of source) {
      const id = String(raw ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [selectedTrafficVolume, selectedTrafficVolumes]);

  const selectedTvKey = selectedTvIds.join("|");
  const showTvColumns = airspaceDisplayMode === "tv" && selectedTvIds.length > 0;

  useEffect(() => {
    const from = Math.floor(Number.isFinite(t) ? t : 0);
    const to = from + parseDurationPresetToSeconds(activePreset);
    setRegulationTimeWindow(from, to);
  }, [activePreset, setRegulationTimeWindow, t]);

  useEffect(() => {
    const reqId = ++tvFlightsReqSeq.current;
    if (!showTvColumns) {
      setTvFlightDataByTv({});
      return;
    }

    const refTime = formatTimeForAPI(t);
    Promise.all(
      selectedTvIds.map(async (tvId) => {
        const response = await authFetch(
          `/api/tv_flights?traffic_volume_id=${encodeURIComponent(tvId)}&ref_time_str=${encodeURIComponent(refTime)}`
        );
        if (!response.ok) {
          throw new Error(`Failed to load flights for ${tvId}`);
        }
        const data = await response.json();
        const payload: TvFlightsPayload =
          data?.ordered_flights && data?.details
            ? { kind: "ordered", data: data as OrderedFlightsData }
            : { kind: "legacy", data: (data || {}) as LegacyFlightsData };
        return [tvId, payload] as const;
      })
    )
      .then((entries) => {
        if (reqId !== tvFlightsReqSeq.current) return;
        setTvFlightDataByTv(Object.fromEntries(entries));
      })
      .catch((error) => {
        if (reqId !== tvFlightsReqSeq.current) return;
        console.error("Failed to load reroute TV flight details:", error);
        setTvFlightDataByTv({});
      });
  }, [resourceStateEpoch, selectedTvIds, selectedTvKey, showTvColumns, t]);

  const tvCellsByFlightAndTv = useMemo(() => {
    const byTv: Record<string, Map<string, TvFlightCell>> = {};

    for (const tvId of selectedTvIds) {
      const payload = tvFlightDataByTv[tvId];
      if (!payload) continue;

      const map = new Map<string, TvFlightCell>();

      if (payload.kind === "ordered") {
        for (const detail of payload.data.details || []) {
          const flightId = String(detail.flight_id ?? "").trim();
          if (!flightId) continue;
          map.set(flightId, {
            arrivalTime: detail.arrival_time || "N/A",
            dwellSeconds: detail.dwell_seconds ?? null,
          });
        }
      } else {
        for (const ids of Object.values(payload.data || {})) {
          for (const rawId of ids || []) {
            const flightId = String(rawId ?? "").trim();
            if (!flightId || map.has(flightId)) continue;
            map.set(flightId, { arrivalTime: "N/A", dwellSeconds: null });
          }
        }
      }

      byTv[tvId] = map;
    }

    return byTv;
  }, [selectedTvIds, tvFlightDataByTv]);

  const flightsById = useMemo(() => {
    const map = new Map<string, (typeof flights)[number]>();
    for (const flight of flights) {
      const id = String(flight?.flightId ?? "").trim();
      if (!id) continue;
      map.set(id, flight);
    }
    return map;
  }, [flights]);

  const rows = useMemo(
    () =>
      rerouteBaseFlightIds.map((id) => {
        const flight = flightsById.get(String(id));
        return {
          flightId: String(id),
          callSign: flight?.callSign ? String(flight.callSign) : String(id),
          origin: flight?.origin ? String(flight.origin) : "—",
          destination: flight?.destination ? String(flight.destination) : "—",
          takeoffTime: formatTimeOfDay(flight?.t0),
          perTv: selectedTvIds.reduce<Record<string, TvFlightCell>>((acc, tvId) => {
            acc[tvId] = tvCellsByFlightAndTv[tvId]?.get(String(id)) || {
              arrivalTime: "N/A",
              dwellSeconds: null,
            };
            return acc;
          }, {}),
          flight,
        };
      }),
    [rerouteBaseFlightIds, flightsById, selectedTvIds, tvCellsByFlightAndTv]
  );

  const listedFlightIds = useMemo(
    () => rows.map((row) => String(row.flightId)).filter((id) => id.length > 0),
    [rows]
  );
  const checkedListedFlightIds = useMemo(
    () => listedFlightIds.filter((id) => rerouteBaseSelectedFlightIds.has(id)),
    [listedFlightIds, rerouteBaseSelectedFlightIds]
  );
  const checkedListedFlightIdSet = useMemo(
    () => new Set(checkedListedFlightIds),
    [checkedListedFlightIds]
  );
  const areAllListedFlightsChecked = listedFlightIds.length > 0 && listedFlightIds.every((id) => checkedListedFlightIdSet.has(id));

  const visibleRows = expanded ? rows : rows.slice(0, MAX_VISIBLE);
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);
  const tableColSpan = 5 + (showTvColumns ? selectedTvIds.length * 2 : 0);
  const panelClassName = embedded
    ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
    : "absolute top-20 right-4 z-50 min-w-[320px] max-w-[400px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col";

  const restoreSelectedPreview = useCallback(() => {
    const snapshot = originalPreviewRef.current;
    if (!snapshot) return;
    setFlowCommunities(
      snapshot.flowCommunities,
      snapshot.flowGroups,
      snapshot.flowColorByCommunity || null
    );
    setFlowPreviewGroupId(snapshot.flowPreviewGroupId);
    setFlowPreviewFlightId(snapshot.flowPreviewFlightId);
    originalPreviewRef.current = null;
  }, [setFlowCommunities, setFlowPreviewFlightId, setFlowPreviewGroupId]);

  const applySelectedPreview = useCallback(() => {
    if (!originalPreviewRef.current) {
      const current = useSimStore.getState();
      originalPreviewRef.current = {
        flowCommunities: current.flowCommunities,
        flowGroups: current.flowGroups,
        flowColorByCommunity: current.flowColorByCommunity,
        flowPreviewGroupId: current.flowPreviewGroupId,
        flowPreviewFlightId: current.flowPreviewFlightId,
      };
    }
    const selectedFlightIds = Array.from(
      new Set(
        rows
          .map((row) => String(row.flightId).trim())
          .filter((id) => id.length > 0 && checkedListedFlightIdSet.has(id))
      )
    );
    const groups = { [REROUTE_BASE_PREVIEW_GROUP_ID]: selectedFlightIds };
    const communities: Record<string, number> = {};
    for (const flightId of selectedFlightIds) {
      communities[flightId] = 0;
    }
    setFlowCommunities(communities, groups, null);
    setFlowPreviewFlightId(null);
    setFlowPreviewGroupId(REROUTE_BASE_PREVIEW_GROUP_ID);
  }, [rows, checkedListedFlightIdSet, setFlowCommunities, setFlowPreviewFlightId, setFlowPreviewGroupId]);

  const toggleListedFlightInclusion = useCallback((flightId: string) => {
    const normalized = String(flightId ?? "").trim();
    if (!normalized) return;
    const current = useSimStore.getState().rerouteBaseSelectedFlightIds;
    const next = new Set(current);
    if (next.has(normalized)) {
      next.delete(normalized);
    } else {
      next.add(normalized);
    }
    setRerouteBaseSelectedFlightIds(next);
  }, [setRerouteBaseSelectedFlightIds]);

  const toggleAllListedFlights = useCallback(() => {
    const next = new Set(useSimStore.getState().rerouteBaseSelectedFlightIds);
    if (areAllListedFlightsChecked) {
      for (const id of listedFlightIds) {
        next.delete(id);
      }
    } else {
      for (const id of listedFlightIds) {
        next.add(id);
      }
    }
    setRerouteBaseSelectedFlightIds(next);
  }, [areAllListedFlightsChecked, listedFlightIds, setRerouteBaseSelectedFlightIds]);

  const removeListedFlight = useCallback((flightId: string) => {
    const normalized = String(flightId ?? "").trim();
    if (!normalized) return;
    removeRerouteBaseFlightIds([normalized], "catcher");
  }, [removeRerouteBaseFlightIds]);

  useEffect(() => {
    if (!previewSelectedOnly) return;
    applySelectedPreview();
  }, [previewSelectedOnly, applySelectedPreview]);

  useEffect(() => {
    return () => {
      restoreSelectedPreview();
    };
  }, [restoreSelectedPreview]);

  useEffect(() => {
    setExpanded(false);
  }, [rows.length, selectedTvKey]);

  return (
    <div className={panelClassName}>
      <div className="p-4 border-b border-white/20">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-semibold truncate">Base Flight List</h2>
            <span className="text-xs px-2 py-0.5 rounded-full border border-white/20 bg-white/10">
              {rows.length.toLocaleString("en-US")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <FlightStatisticsButton
              flightIds={rows.map((row) => row.flightId)}
              buttonClassName="border-white/20 text-white/80"
              title="Open flight statistics"
              ariaLabel="Open flight statistics"
            />
            <button
              type="button"
              onClick={() => {
                setPreviewSelectedOnly((prev) => {
                  const next = !prev;
                  if (next) {
                    applySelectedPreview();
                  } else {
                    restoreSelectedPreview();
                  }
                  return next;
                });
              }}
              disabled={rows.length === 0 && !previewSelectedOnly}
              className={`h-7 w-7 flex items-center justify-center rounded-lg border text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                previewSelectedOnly
                  ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                  : "border-white/30 bg-white/20 hover:bg-white/30 text-white/80"
              }`}
              title={previewSelectedOnly ? "Hide selected-flight preview" : "Show selected-flight preview"}
              aria-label="Toggle selected-flight preview"
            >
              {previewSelectedOnly ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zm11 3a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a18.86 18.86 0 015.06-5.94M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 7 11 7a18.86 18.86 0 01-3.17 4.13M1 1l22 22" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={clearRerouteBaseFlightIds}
              disabled={rows.length === 0 || showTvColumns}
              className="h-7 text-xs px-2.5 rounded-md border border-white/20 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
              title={showTvColumns ? "TV selection controls this list" : "Clear base flight list"}
            >
              Clear
            </button>
          </div>
        </div>
        {showTvColumns && (
          <div className="mt-3 bg-white/5 border border-white/10 rounded-lg p-3">
            <div className="text-[11px] font-medium opacity-90">Active Time Window</div>
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {TIME_WINDOW_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setActivePreset(preset)}
                  className={`px-2 py-1.5 text-[11px] font-medium rounded border transition-colors ${
                    activePreset === preset
                      ? "bg-blue-500/30 border-blue-400/50 text-blue-200"
                      : "bg-white/10 border-white/20 text-white/80 hover:bg-white/15"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="text-[11px] opacity-70 mt-2">
              From {formatTimeOfDay(regulationTimeWindow[0])} to {formatTimeOfDay(regulationTimeWindow[1])}
            </div>
          </div>
        )}
      </div>

      <div className="p-4">
        {rows.length === 0 ? (
          <p className="text-xs opacity-70 text-center py-8">No flights in the base list.</p>
        ) : (
          <div className="rounded-lg border border-white/10 overflow-x-auto">
            <table className="w-full min-w-max text-xs">
              <thead>
                <tr className="bg-white/10">
                  <th className="text-center p-2 font-semibold w-8">
                    {showTvColumns ? (
                      <button
                        type="button"
                        className="w-full h-full text-center hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={toggleAllListedFlights}
                        disabled={listedFlightIds.length === 0}
                        title={areAllListedFlightsChecked ? "Uncheck all listed flights" : "Check all listed flights"}
                        aria-label={areAllListedFlightsChecked ? "Uncheck all listed flights" : "Check all listed flights"}
                      >
                        ✓
                      </button>
                    ) : (
                      <span className="opacity-70">×</span>
                    )}
                  </th>
                  <th className="text-left p-2 font-semibold">CS</th>
                  <th className="text-left p-2 font-semibold">Ori.</th>
                  <th className="text-left p-2 font-semibold">Des.</th>
                  <th className="text-left p-2 font-semibold">T/O</th>
                  {showTvColumns &&
                    selectedTvIds.map((tvId) => (
                      <Fragment key={`cols-${tvId}`}>
                        <th className="text-left p-2 font-semibold whitespace-nowrap">
                          {selectedTvIds.length === 1 ? "TV Arr." : `${tvId} Arr.`}
                        </th>
                        <th className="text-left p-2 font-semibold whitespace-nowrap">
                          {selectedTvIds.length === 1 ? "Dwell" : `${tvId} Dwell`}
                        </th>
                      </Fragment>
                    ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => {
                  const isChecked = checkedListedFlightIdSet.has(row.flightId);
                  const rowClass = showTvColumns
                    ? isChecked
                      ? index % 2 === 0
                        ? "bg-white/0 hover:bg-white/10"
                        : "bg-white/5 hover:bg-white/10"
                      : "bg-rose-500/15 hover:bg-rose-500/25"
                    : index % 2 === 0
                      ? "bg-white/0 hover:bg-white/10"
                      : "bg-white/5 hover:bg-white/10";
                  const inactiveTextClass = showTvColumns && !isChecked ? "text-white/60 line-through" : "";
                  return (
                    <tr
                      key={`${row.flightId}-${index}`}
                      className={`border-t border-white/10 ${rowClass} cursor-pointer`}
                      onMouseEnter={() => {
                        if (!previewSelectedOnly) setFlowPreviewFlightId(row.flightId);
                      }}
                      onMouseLeave={() => {
                        if (!previewSelectedOnly) setFlowPreviewFlightId(null);
                      }}
                      onClick={() => {
                        if (!row.flight) return;
                        window.dispatchEvent(
                          new CustomEvent("flight-search-select", { detail: { flight: row.flight } })
                        );
                      }}
                    >
                      <td className="p-2 text-center w-8">
                        {showTvColumns ? (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleListedFlightInclusion(row.flightId)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-4 w-4 cursor-pointer rounded border border-white/40 bg-white/10 accent-blue-400"
                            aria-label={`${isChecked ? "Uncheck" : "Check"} flight ${row.callSign}`}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeListedFlight(row.flightId);
                            }}
                            className="text-red-200 hover:text-red-100"
                            title={`Remove flight ${row.callSign}`}
                            aria-label={`Remove flight ${row.callSign}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M6 7h12M9 7v10m6-10v10M4 7h16l-1 14H5L4 7zm5-3h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                          </button>
                        )}
                      </td>
                      <td className={`p-2 font-mono ${inactiveTextClass}`}>{row.callSign}</td>
                      <td className={`p-2 ${inactiveTextClass}`}>{row.origin}</td>
                      <td className={`p-2 ${inactiveTextClass}`}>{row.destination}</td>
                      <td className={`p-2 text-right font-mono ${inactiveTextClass}`}>{row.takeoffTime}</td>
                      {showTvColumns &&
                        selectedTvIds.map((tvId) => (
                          <Fragment key={`${row.flightId}-${tvId}`}>
                            <td className={`p-2 text-right font-mono ${inactiveTextClass}`}>
                              {row.perTv[tvId]?.arrivalTime ?? "N/A"}
                            </td>
                            <td className={`p-2 text-right font-mono ${inactiveTextClass}`}>
                              {formatDwellingTime(row.perTv[tvId]?.dwellSeconds ?? null)}
                            </td>
                          </Fragment>
                        ))}
                    </tr>
                  );
                })}
                {rows.length > MAX_VISIBLE && (
                  <tr
                    className="border-t border-white/10 cursor-pointer hover:bg-white/10"
                    onClick={() => setExpanded((prev) => !prev)}
                  >
                    <td className="p-2 text-center italic opacity-80" colSpan={tableColSpan}>
                      {expanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenCount)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function parseDurationPresetToSeconds(preset: string): number {
  const normalized = String(preset || "").trim().toLowerCase();
  const hIndex = normalized.indexOf("h");
  if (hIndex !== -1) {
    const hoursPart = normalized.slice(0, hIndex);
    const minutesPart = normalized.slice(hIndex + 1);
    const hours = Number.parseInt(hoursPart, 10) || 0;
    const minutes = minutesPart ? Number.parseInt(minutesPart, 10) || 0 : 0;
    return (hours * 60 + minutes) * 60;
  }
  const minutesOnly = Number.parseInt(normalized, 10) || 0;
  return minutesOnly * 60;
}

function formatTimeOfDay(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds ?? NaN)) return "—";
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatTimeForAPI(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}${String(secs).padStart(2, "0")}`;
}
