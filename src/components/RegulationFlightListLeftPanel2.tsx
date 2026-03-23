"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSimStore } from "@/components/useSimStore";
import HourGlass from "@/components/HourGlass";
import ShimmeringText from "@/components/ShimmeringText";
import { authFetch } from "@/lib/auth";
import { formatDwellingTime } from "@/lib/dwellTime";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import FlightStatisticsDialog from "@/components/FlightStatisticsDialog";
import {
  compareIntersectionFlightRows,
  intersectStringSets,
  matchesSelectedTvTraversalOrder,
  type FlightSortMetric,
} from "@/lib/airspaceInfoMultiTv";

interface RankedFlight {
  flight_id: string;
  arrival_time: string; // HH:MM or HH:MM:SS
  time_window: string; // HH:MM-HH:MM
  delta_seconds: number;
  dwell_seconds?: number | null;
  flight_level_range?: {
    min_fl?: number | null;
    max_fl?: number | null;
    label?: string | null;
    scope?: string | null;
  } | null;
}

interface RankedFlightsResponse {
  traffic_volume_id: string;
  ref_time_str: string;
  seed_flight_ids: string[];
  ranked_flights: RankedFlight[];
  metadata?: {
    num_candidates?: number;
    num_ranked?: number;
    time_bin_minutes?: number;
    duration_min?: number;
  };
}

interface FlightIdentifiersData {
  [timeWindow: string]: string[];
}

interface OrderedTvFlightsData {
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
    flight_level_range?: {
      min_fl?: number | null;
      max_fl?: number | null;
      label?: string | null;
      scope?: string | null;
    } | null;
  }[];
}

type TvFlightsPayload =
  | { kind: "ordered"; data: OrderedTvFlightsData }
  | { kind: "legacy"; data: FlightIdentifiersData };

type TvFlightCell = {
  arrivalTime: string;
  flightLevelRangeLabel: string | null;
  dwellSeconds: number | null;
  arrivalSeconds: number | null;
  deltaSeconds: number | null;
  windowStartSeconds: number | null;
};

type RegulationFlightListRow = {
  flightId: string;
  callsign: string;
  origin: string;
  destination: string;
  perTv: Record<string, TvFlightCell>;
  sortMetric: FlightSortMetric;
};

type RegulationFlightListLeftPanel2Props = { embedded?: boolean };

export default function RegulationFlightListLeftPanel2({ embedded = false }: RegulationFlightListLeftPanel2Props) {
  const {
    selectedTrafficVolume,
    selectedTrafficVolumes,
    t,
    flights,
    resourceStateEpoch,
    regulationTimeWindow,
    regulationTargetFlightIds,
    addRegulationTargetFlight,
    setRegulationVisibleFlightIds,
    setRegulationListedFlightIds,
    setFlowPreviewFlightId,
  } = useSimStore();

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
  }, [selectedTrafficVolumes, selectedTrafficVolume]);
  const selectedTvKey = selectedTvIds.join("|");
  const primaryTvId = selectedTvIds[0] ?? null;
  const secondaryTvIds = useMemo(() => selectedTvIds.slice(1), [selectedTvIds]);

  const [rankingData, setRankingData] = useState<RankedFlightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondaryFlightDataByTv, setSecondaryFlightDataByTv] = useState<Record<string, TvFlightsPayload>>({});
  const [secondaryLoading, setSecondaryLoading] = useState(false);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const MAX_VISIBLE = 20;
  const [statsOpen, setStatsOpen] = useState(false);

  useEffect(() => {
    setRankingData(null);
    setSecondaryFlightDataByTv({});
    setLoading(false);
    setSecondaryLoading(false);
    setError(null);
    setSecondaryError(null);
    setExpanded(false);
  }, [resourceStateEpoch]);

  const flightsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const flight of flights || []) {
      map.set(String(flight.flightId), flight);
    }
    return map;
  }, [flights]);

  // Compute seed flight identifiers from regulation targets (stored as callsigns)
  const seedFlightIds = useMemo(() => {
    if (!flights || flights.length === 0 || !regulationTargetFlightIds) return [] as string[];
    const seeds = new Set<string>();
    for (const token of Array.from(regulationTargetFlightIds)) {
      const byId = flights.find(f => String(f.flightId) === String(token));
      if (byId?.flightId) { seeds.add(String(byId.flightId)); continue; }
      const byCs = flights.find(f => f.callSign && String(f.callSign) === String(token));
      if (byCs?.flightId) seeds.add(String(byCs.flightId));
    }
    return Array.from(seeds);
  }, [flights, regulationTargetFlightIds]);

  // Fetch ranked flights for the primary TV using the regulation ranking endpoint
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!primaryTvId) { setRankingData(null); return; }
      setLoading(true);
      setError(null);
      try {
        const ref = formatTimeForAPI(t);
        const topK = 500;
        const [from, to] = regulationTimeWindow;
        const durationSeconds = Math.max(0, (to ?? 0) - (from ?? 0));
        const durationMin = Math.max(1, Math.round(durationSeconds / 60));
        const params = new URLSearchParams({
          traffic_volume_id: String(primaryTvId),
          ref_time_str: String(ref),
          seed_flight_ids: seedFlightIds && seedFlightIds.length > 0 ? seedFlightIds.join(',') : '',
          duration_min: String(durationMin),
          top_k: String(topK),
        });
        const res = await authFetch(`/api/regulation_ranking_tv_flights_ordered?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch ranked flights');
        const data: RankedFlightsResponse = await res.json();
        if (cancelled) return;
        setRankingData(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to fetch ranked flights');
        setRankingData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [primaryTvId, resourceStateEpoch, regulationTimeWindow, seedFlightIds, t]);

  // Fetch membership/details for secondary TVs to support intersection + per-TV columns
  useEffect(() => {
    let cancelled = false;
    async function loadSecondaryFlights() {
      if (!primaryTvId || secondaryTvIds.length === 0) {
        setSecondaryFlightDataByTv({});
        setSecondaryLoading(false);
        setSecondaryError(null);
        return;
      }
      setSecondaryLoading(true);
      setSecondaryError(null);
      try {
        const ref = formatTimeForAPI(t);
        const entries = await Promise.all(
          secondaryTvIds.map(async (tvId) => {
            const res = await authFetch(`/api/tv_flights?traffic_volume_id=${encodeURIComponent(tvId)}&ref_time_str=${encodeURIComponent(ref)}`);
            if (!res.ok) {
              throw new Error(`Failed to fetch flights for ${tvId}`);
            }
            const data = await res.json();
            const payload: TvFlightsPayload = data.ordered_flights && data.details
              ? { kind: 'ordered', data: data as OrderedTvFlightsData }
              : { kind: 'legacy', data: data as FlightIdentifiersData };
            return [tvId, payload] as const;
          })
        );
        if (cancelled) return;
        setSecondaryFlightDataByTv(Object.fromEntries(entries));
      } catch (e: any) {
        if (!cancelled) {
          setSecondaryError(e?.message || 'Failed to fetch intersecting flight data');
          setSecondaryFlightDataByTv({});
        }
      } finally {
        if (!cancelled) setSecondaryLoading(false);
      }
    }
    loadSecondaryFlights();
    return () => { cancelled = true; };
  }, [primaryTvId, resourceStateEpoch, secondaryTvIds, selectedTvKey, t]);

  const filteredRankedFlights = useMemo(() => {
    if (!rankingData?.ranked_flights) return [] as RankedFlight[];
    const [from, to] = regulationTimeWindow;
    return rankingData.ranked_flights.filter((rf) => {
      const sec = parseHHMMSSToSeconds(rf.arrival_time);
      return sec >= from && sec <= to;
    });
  }, [rankingData, regulationTimeWindow]);

  const rows = useMemo(() => {
    if (!primaryTvId || filteredRankedFlights.length === 0) return [] as RegulationFlightListRow[];
    if (secondaryTvIds.length > 0) {
      const missingSecondary = secondaryTvIds.some((tvId) => !Object.prototype.hasOwnProperty.call(secondaryFlightDataByTv, tvId));
      if (missingSecondary) return [] as RegulationFlightListRow[];
    }

    const secondaryMembershipSets: Array<Set<string>> = [];
    const orderedDetailMapByTv: Record<string, Map<string, OrderedTvFlightsData['details'][number]>> = {};
    const legacyWindowStartByTv: Record<string, Map<string, number | null>> = {};

    for (const tvId of secondaryTvIds) {
      const payload = secondaryFlightDataByTv[tvId];
      if (!payload) return [] as RegulationFlightListRow[];

      if (payload.kind === 'ordered') {
        const membership = new Set<string>();
        for (const fid of payload.data.ordered_flights || []) membership.add(String(fid));
        if (membership.size === 0) {
          for (const detail of payload.data.details || []) membership.add(String(detail.flight_id));
        }
        secondaryMembershipSets.push(membership);

        const detailMap = new Map<string, OrderedTvFlightsData['details'][number]>();
        for (const detail of payload.data.details || []) {
          detailMap.set(String(detail.flight_id), detail);
        }
        orderedDetailMapByTv[tvId] = detailMap;
      } else {
        const membership = new Set<string>();
        const startMap = new Map<string, number | null>();
        for (const [timeWindow, ids] of Object.entries(payload.data || {})) {
          const startSeconds = parseTimeWindowStartSeconds(timeWindow);
          for (const rawId of ids || []) {
            const fid = String(rawId);
            membership.add(fid);
            if (!startMap.has(fid)) startMap.set(fid, startSeconds);
          }
        }
        secondaryMembershipSets.push(membership);
        legacyWindowStartByTv[tvId] = startMap;
      }
    }

    const primaryMembershipSet = new Set(filteredRankedFlights.map((rf) => String(rf.flight_id)));
    const intersectionSet = secondaryMembershipSets.length > 0
      ? intersectStringSets([primaryMembershipSet, ...secondaryMembershipSets])
      : primaryMembershipSet;

    const nextRows: RegulationFlightListRow[] = filteredRankedFlights
      .filter((rf) => intersectionSet.has(String(rf.flight_id)))
      .map((rf) => {
        const flightId = String(rf.flight_id);
        const flight = flightsById.get(flightId);

        const primaryArrivalSeconds = parseHHMMSSToSeconds(rf.arrival_time);
        const primaryWindowStartSeconds = parseTimeWindowStartSeconds(rf.time_window);

        const perTv: Record<string, TvFlightCell> = {
          [primaryTvId]: {
            arrivalTime: rf.arrival_time || 'N/A',
            flightLevelRangeLabel: formatFlightLevelRangeLabel(rf.flight_level_range),
            dwellSeconds: rf.dwell_seconds ?? null,
            arrivalSeconds: Number.isFinite(primaryArrivalSeconds) ? primaryArrivalSeconds : null,
            deltaSeconds: typeof rf.delta_seconds === 'number' && Number.isFinite(rf.delta_seconds) ? rf.delta_seconds : null,
            windowStartSeconds: primaryWindowStartSeconds,
          },
        };

        const sortPerTv: FlightSortMetric['perTv'] = {
          [primaryTvId]: {
            arrivalSeconds: Number.isFinite(primaryArrivalSeconds) ? primaryArrivalSeconds : null,
            deltaSeconds: typeof rf.delta_seconds === 'number' && Number.isFinite(rf.delta_seconds) ? rf.delta_seconds : null,
            windowStartSeconds: primaryWindowStartSeconds,
          },
        };

        for (const tvId of secondaryTvIds) {
          const payload = secondaryFlightDataByTv[tvId];
          if (!payload) continue;

          if (payload.kind === 'ordered') {
            const detail = orderedDetailMapByTv[tvId]?.get(flightId);
            const arrivalSeconds = detail && typeof detail.arrival_seconds === 'number' && Number.isFinite(detail.arrival_seconds)
              ? detail.arrival_seconds
              : null;
            const deltaSeconds = detail && typeof detail.delta_seconds === 'number' && Number.isFinite(detail.delta_seconds)
              ? detail.delta_seconds
              : null;
            const windowStartSeconds = detail?.time_window ? parseTimeWindowStartSeconds(detail.time_window) : null;

            perTv[tvId] = {
              arrivalTime: detail?.arrival_time || 'N/A',
              flightLevelRangeLabel: formatFlightLevelRangeLabel(detail?.flight_level_range),
              dwellSeconds: detail?.dwell_seconds ?? null,
              arrivalSeconds,
              deltaSeconds,
              windowStartSeconds,
            };
            sortPerTv[tvId] = { arrivalSeconds, deltaSeconds, windowStartSeconds };
          } else {
            const windowStartSeconds = legacyWindowStartByTv[tvId]?.get(flightId) ?? null;
            perTv[tvId] = {
              arrivalTime: 'N/A',
              flightLevelRangeLabel: null,
              dwellSeconds: null,
              arrivalSeconds: null,
              deltaSeconds: null,
              windowStartSeconds,
            };
            sortPerTv[tvId] = {
              arrivalSeconds: null,
              deltaSeconds: null,
              windowStartSeconds,
            };
          }
        }

        return {
          flightId,
          callsign: flight?.callSign || flightId,
          origin: flight?.origin || 'N/A',
          destination: flight?.destination || 'N/A',
          perTv,
          sortMetric: {
            flightId,
            perTv: sortPerTv,
          },
        };
      });
    const orderedRows = nextRows.filter((row) =>
      matchesSelectedTvTraversalOrder(row.sortMetric.perTv, selectedTvIds),
    );

    if (selectedTvIds.length > 1) {
      orderedRows.sort((a, b) => compareIntersectionFlightRows(a.sortMetric, b.sortMetric, primaryTvId));
    }

    return orderedRows;
  }, [primaryTvId, selectedTvIds, secondaryTvIds, secondaryFlightDataByTv, filteredRankedFlights, flightsById]);

  const hourGlassArrivalData = useMemo(() => {
    if (!primaryTvId) return [] as string[];
    const data: string[] = [];
    for (const row of rows) {
      const arrival = row.perTv[primaryTvId]?.arrivalTime;
      if (arrival && arrival !== 'N/A') data.push(String(arrival));
    }
    return data;
  }, [rows, primaryTvId]);

  const visibleRows = useMemo(() => {
    if (!rows) return [] as RegulationFlightListRow[];
    if (!expanded && rows.length > MAX_VISIBLE) return rows.slice(0, MAX_VISIBLE);
    return rows;
  }, [rows, expanded]);
  const hiddenRowCount = Math.max(0, rows.length - MAX_VISIBLE);

  useEffect(() => {
    const ids = visibleRows.map(r => String(r.flightId));
    setRegulationVisibleFlightIds(ids);
  }, [visibleRows, setRegulationVisibleFlightIds]);

  useEffect(() => {
    const allIds = rows.map(r => String(r.flightId));
    setRegulationListedFlightIds(allIds);
  }, [rows, setRegulationListedFlightIds]);

  useEffect(() => {
    setExpanded(false);
  }, [selectedTvKey, regulationTimeWindow[0], regulationTimeWindow[1]]);

  useEffect(() => {
    return () => { setFlowPreviewFlightId(null); };
  }, [setFlowPreviewFlightId]);

  const isLoading = loading || (secondaryTvIds.length > 0 && secondaryLoading);
  const combinedError = error || secondaryError;
  const tableColSpan = 4 + (selectedTvIds.length * 3);

  if (!primaryTvId) return null;

  return (
    <div className={embedded
      ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"
      : "w-full max-h-[40vh] min-h-0 flex-shrink-0 rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col overflow-hidden"}>
      <div className="flex items-center justify-between p-3 border-b border-white/20 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-semibold text-sm">Flight List ({rows.length})</h3>
          {selectedTvIds.length > 1 && (
            <span className="text-[10px] opacity-70 truncate">Intersection across {selectedTvIds.length} TVs</span>
          )}
          <button
            type="button"
            className="h-6 w-6 p-0 rounded hover:bg-white/10 border border-white/10 text-white/90 flex items-center justify-center"
            onClick={() => setStatsOpen(true)}
            aria-label="Open flight statistics"
            title="Open flight statistics"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16.3891 8.11096L8.61091 15.8891" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16.3891 8.11096L16.7426 12" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16.3891 8.11096L12.5 7.75741" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <span className="text-xs opacity-70">{formatTime(regulationTimeWindow[0])}–{formatTime(regulationTimeWindow[1])}</span>
      </div>
      <div className={embedded ? "px-3 pb-3 overflow-x-auto" : "px-3 pb-3 flex-1 min-h-0 overflow-y-auto overflow-x-auto"}>
        {hourGlassArrivalData.length > 0 && (
          <div className="py-2">
            <HourGlass
              data={hourGlassArrivalData}
              range={[formatTime(regulationTimeWindow[0]), formatTime(regulationTimeWindow[1])]}
              height={12}
              defaultColor="#22d3ee"
              lineWidth={1}
              lineHeightPct={0.7}
              gloss={false}
            />
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]"></div>
            <ShimmeringText text="Loading..." className="ml-2 text-xs opacity-70" />
          </div>
        ) : combinedError ? (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-2 mb-3 text-xs">{combinedError}</div>
        ) : rows.length > 0 ? (
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/10">
                  <th className="text-center p-2 font-semibold w-6">✓</th>
                  <th className="text-left p-2 font-semibold">CS</th>
                  <th className="text-left p-2 font-semibold">Ori.</th>
                  <th className="text-left p-2 font-semibold">Des.</th>
                  {selectedTvIds.map((tvId) => (
                    <Fragment key={tvId}>
                      <th className="text-left p-2 font-semibold whitespace-nowrap">
                        {selectedTvIds.length === 1 ? 'TV Arr.' : `${tvId} Arr.`}
                      </th>
                      <th className="text-left p-2 font-semibold whitespace-nowrap min-w-[72px]">
                        {selectedTvIds.length === 1 ? 'FL' : `${tvId} FL`}
                      </th>
                      <th className="text-left p-2 font-semibold whitespace-nowrap">
                        {selectedTvIds.length === 1 ? 'Dwell' : `${tvId} Dwell`}
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, idx) => {
                  const isTargeted = regulationTargetFlightIds.has(String(row.flightId));
                  return (
                    <tr
                      key={row.flightId}
                      className={`border-t border-white/10 ${idx % 2 === 0 ? 'bg-white/0' : 'bg-white/5'} cursor-pointer ${isTargeted ? 'bg-emerald-500/10 hover:bg-emerald-500/15' : 'hover:bg-white/10'}`}
                      onMouseEnter={() => setFlowPreviewFlightId(String(row.flightId))}
                      onMouseLeave={() => setFlowPreviewFlightId(null)}
                      onClick={() => {
                        const full = flightsById.get(String(row.flightId));
                        if (full) {
                          window.dispatchEvent(new CustomEvent('flight-search-select', { detail: { flight: full } }));
                          addRegulationTargetFlight(String(full.flightId));
                        }
                      }}
                    >
                      <td className="p-2 text-center w-6">{isTargeted ? '✓' : ''}</td>
                      <td className="p-2 font-mono">{row.callsign}</td>
                      <td className="p-2">{row.origin}</td>
                      <td className="p-2">{row.destination}</td>
                      {selectedTvIds.map((tvId) => {
                        const cell = row.perTv[tvId];
                        return (
                          <Fragment key={tvId}>
                            <td className="p-2 text-right font-mono">{cell?.arrivalTime || 'N/A'}</td>
                            <td className="p-2 text-right font-mono whitespace-nowrap min-w-[72px]">{cell?.flightLevelRangeLabel ?? 'N/A'}</td>
                            <td className="p-2 text-right font-mono">{formatDwellingTime(cell?.dwellSeconds ?? null)}</td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
                {rows.length > MAX_VISIBLE && (
                  <tr
                    className="border-t border-white/10 cursor-pointer hover:bg-white/10"
                    onClick={() => setExpanded(!expanded)}
                  >
                    <td className="p-2 text-center italic opacity-80" colSpan={tableColSpan}>
                      {expanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenRowCount)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs opacity-70 text-center py-4">
            {selectedTvIds.length > 1
              ? 'No intersecting flights found for this time window'
              : 'No flights found for this time window'}
          </p>
        )}
      </div>
      {statsOpen && typeof window !== 'undefined' && createPortal(
        <FlightStatisticsDialog
          open={statsOpen}
          onClose={() => setStatsOpen(false)}
          flightIds={rows.map(r => String(r.flightId))}
          sourceTrafficVolumeId={primaryTvId}
          fullScreen
        />,
        document.body
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
}

function formatTimeForAPI(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, '0')}${minutes.toString().padStart(2, '0')}${secs.toString().padStart(2, '0')}`;
}

function parseHHMMSSToSeconds(value: string): number {
  const parts = String(value || '').split(":").map(Number);
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  return h * 3600 + m * 60 + s;
}

function parseTimeWindowStartSeconds(timeWindow: string): number | null {
  try {
    const [start = ''] = String(timeWindow || '').split('-');
    const [h = 0, m = 0] = start.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 3600 + m * 60;
  } catch {
    return null;
  }
}

function formatFlightLevelRangeLabel(
  range:
    | {
        min_fl?: number | null;
        max_fl?: number | null;
        label?: string | null;
      }
    | null
    | undefined,
): string | null {
  const label = String(range?.label ?? '').trim();
  if (label) {
    const compactLabel = label.match(/^FL\s*(-?\d+)(?:-FL\s*(-?\d+))?$/i);
    if (compactLabel) {
      const [, start, end] = compactLabel;
      return end ? `${start}-${end}` : start;
    }
    return label;
  }

  const minFl = typeof range?.min_fl === 'number' ? range.min_fl : Number(range?.min_fl);
  const maxFl = typeof range?.max_fl === 'number' ? range.max_fl : Number(range?.max_fl);
  if (!Number.isFinite(minFl) || !Number.isFinite(maxFl)) return null;
  if (minFl < 0 || maxFl < 0) return '-1';
  return `${Math.round(minFl)}-${Math.round(maxFl)}`;
}
