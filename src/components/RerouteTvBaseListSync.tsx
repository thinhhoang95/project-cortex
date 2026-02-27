"use client";

import { useEffect, useMemo, useRef } from "react";
import { authFetch } from "@/lib/auth";
import { compareIntersectionFlightRows, intersectStringSets, type FlightSortMetric } from "@/lib/airspaceInfoMultiTv";
import { useSimStore } from "@/components/useSimStore";

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

export default function RerouteTvBaseListSync() {
  const {
    selectedTrafficVolume,
    selectedTrafficVolumes,
    airspaceDisplayMode,
    t,
    regulationTimeWindow,
    setRerouteBaseFlightIds,
    setRerouteBaseSelectedFlightIds,
    setFocusMode,
    setFocusFlightIds,
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
  }, [selectedTrafficVolume, selectedTrafficVolumes]);

  const selectedTvKey = selectedTvIds.join("|");
  const requestSeq = useRef(0);
  const appliedTvFocusRef = useRef(false);
  const previousSelectionContextKeyRef = useRef<string | null>(null);
  const previousBaseFlightIdSetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (airspaceDisplayMode !== "tv") {
      if (appliedTvFocusRef.current) {
        setFocusMode(false);
        setFocusFlightIds(new Set());
        appliedTvFocusRef.current = false;
      }
      previousSelectionContextKeyRef.current = null;
      previousBaseFlightIdSetRef.current = new Set();
      return;
    }

    if (!selectedTvIds.length) {
      if (appliedTvFocusRef.current) {
        setRerouteBaseFlightIds([], "tv");
        setFocusMode(false);
        setFocusFlightIds(new Set());
        appliedTvFocusRef.current = false;
      }
      previousSelectionContextKeyRef.current = null;
      previousBaseFlightIdSetRef.current = new Set();
      return;
    }

    const reqId = ++requestSeq.current;
    const refTime = formatTimeForAPI(t);
    const { from: windowFrom, to: windowTo } = normalizeTimeWindow(regulationTimeWindow, t);
    const listSelectionContextKey = `${selectedTvKey}|${windowFrom}-${windowTo}`;

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
        if (reqId !== requestSeq.current) return;

        const payloadByTv = Object.fromEntries(entries) as Record<string, TvFlightsPayload>;
        const orderedFlightIds = buildBaseListForSelection(
          selectedTvIds,
          payloadByTv,
          windowFrom,
          windowTo
        );
        const nextBaseSet = new Set(orderedFlightIds);
        const prevContext = previousSelectionContextKeyRef.current;
        const prevBaseSet = previousBaseFlightIdSetRef.current;
        const currentSelected = useSimStore.getState().rerouteBaseSelectedFlightIds;
        let nextSelected = new Set<string>();
        if (prevContext !== listSelectionContextKey) {
          nextSelected = new Set(orderedFlightIds);
        } else {
          for (const id of orderedFlightIds) {
            if (!prevBaseSet.has(id) || currentSelected.has(id)) {
              nextSelected.add(id);
            }
          }
        }
        setRerouteBaseFlightIds(orderedFlightIds, "tv");
        setRerouteBaseSelectedFlightIds(nextSelected);
        setFocusMode(true);
        setFocusFlightIds(new Set(orderedFlightIds));
        appliedTvFocusRef.current = true;
        previousSelectionContextKeyRef.current = listSelectionContextKey;
        previousBaseFlightIdSetRef.current = nextBaseSet;
      })
      .catch((error) => {
        if (reqId !== requestSeq.current) return;
        console.error("Failed to synchronize reroute base list from selected TVs:", error);
        setRerouteBaseFlightIds([], "tv");
        setFocusMode(true);
        setFocusFlightIds(new Set());
        appliedTvFocusRef.current = true;
        previousSelectionContextKeyRef.current = null;
        previousBaseFlightIdSetRef.current = new Set();
      });
  }, [
    airspaceDisplayMode,
    selectedTvKey,
    selectedTvIds,
    t,
    regulationTimeWindow,
    setRerouteBaseFlightIds,
    setRerouteBaseSelectedFlightIds,
    setFocusMode,
    setFocusFlightIds,
  ]);

  return null;
}

function buildBaseListForSelection(
  selectedTvIds: string[],
  payloadByTv: Record<string, TvFlightsPayload>,
  windowFrom: number,
  windowTo: number
): string[] {
  if (selectedTvIds.length === 0) return [];
  const primaryTvId = selectedTvIds[0] ?? null;
  if (!primaryTvId) return [];

  const primaryPayload = payloadByTv[primaryTvId];
  if (!primaryPayload) return [];

  const primaryRows = buildPrimaryRows(primaryTvId, primaryPayload, windowFrom, windowTo);
  if (primaryRows.length === 0) return [];
  if (selectedTvIds.length === 1) return primaryRows.map((row) => row.flightId);

  const secondaryTvIds = selectedTvIds.slice(1);
  const secondaryMembershipSets: Array<Set<string>> = [];
  const orderedMetricsByTv: Record<string, Map<string, FlightSortMetric["perTv"][string]>> = {};
  const legacyWindowStartByTv: Record<string, Map<string, number | null>> = {};

  for (const tvId of secondaryTvIds) {
    const payload = payloadByTv[tvId];
    if (!payload) return [];

    if (payload.kind === "ordered") {
      const membership = new Set<string>();
      for (const rawId of payload.data.ordered_flights || []) {
        const id = String(rawId ?? "").trim();
        if (!id) continue;
        membership.add(id);
      }
      if (membership.size === 0) {
        for (const detail of payload.data.details || []) {
          const id = String(detail.flight_id ?? "").trim();
          if (!id) continue;
          membership.add(id);
        }
      }
      secondaryMembershipSets.push(membership);

      const metricMap = new Map<string, FlightSortMetric["perTv"][string]>();
      for (const detail of payload.data.details || []) {
        const id = String(detail.flight_id ?? "").trim();
        if (!id) continue;
        const arrivalFromString = detail.arrival_time ? parseHHMMSSToSeconds(detail.arrival_time) : null;
        metricMap.set(id, {
          arrivalSeconds:
            typeof detail.arrival_seconds === "number" && Number.isFinite(detail.arrival_seconds)
              ? detail.arrival_seconds
              : arrivalFromString,
          deltaSeconds:
            typeof detail.delta_seconds === "number" && Number.isFinite(detail.delta_seconds)
              ? detail.delta_seconds
              : null,
          windowStartSeconds: parseTimeWindowStartSeconds(detail.time_window),
        });
      }
      orderedMetricsByTv[tvId] = metricMap;
      continue;
    }

    const membership = new Set<string>();
    const startMap = new Map<string, number | null>();
    for (const [window, ids] of Object.entries(payload.data || {})) {
      const windowStart = parseTimeWindowStartSeconds(window);
      for (const rawId of ids || []) {
        const id = String(rawId ?? "").trim();
        if (!id) continue;
        membership.add(id);
        if (!startMap.has(id)) startMap.set(id, windowStart);
      }
    }
    secondaryMembershipSets.push(membership);
    legacyWindowStartByTv[tvId] = startMap;
  }

  const intersection = intersectStringSets([
    new Set(primaryRows.map((row) => row.flightId)),
    ...secondaryMembershipSets,
  ]);

  const sortableRows: FlightSortMetric[] = [];
  for (const row of primaryRows) {
    if (!intersection.has(row.flightId)) continue;
    const perTv: FlightSortMetric["perTv"] = { ...row.sortMetric.perTv };

    for (const tvId of secondaryTvIds) {
      const payload = payloadByTv[tvId];
      if (!payload) continue;
      if (payload.kind === "ordered") {
        perTv[tvId] =
          orderedMetricsByTv[tvId]?.get(row.flightId) || {
            arrivalSeconds: null,
            deltaSeconds: null,
            windowStartSeconds: null,
          };
      } else {
        perTv[tvId] = {
          arrivalSeconds: null,
          deltaSeconds: null,
          windowStartSeconds: legacyWindowStartByTv[tvId]?.get(row.flightId) ?? null,
        };
      }
    }

    sortableRows.push({
      flightId: row.flightId,
      perTv,
    });
  }

  sortableRows.sort((a, b) => compareIntersectionFlightRows(a, b, primaryTvId));
  return sortableRows.map((row) => row.flightId);
}

function buildPrimaryRows(
  primaryTvId: string,
  payload: TvFlightsPayload,
  windowFrom: number,
  windowTo: number
): Array<{ flightId: string; sortMetric: FlightSortMetric }> {
  if (payload.kind === "ordered") {
    const filteredDetails = (payload.data.details || [])
      .map((detail) => {
        const flightId = String(detail.flight_id ?? "").trim();
        const arrivalFromString = detail.arrival_time ? parseHHMMSSToSeconds(detail.arrival_time) : null;
        const arrivalSeconds =
          typeof detail.arrival_seconds === "number" && Number.isFinite(detail.arrival_seconds)
            ? detail.arrival_seconds
            : arrivalFromString;
        const deltaSeconds =
          typeof detail.delta_seconds === "number" && Number.isFinite(detail.delta_seconds)
            ? detail.delta_seconds
            : null;

        return {
          flightId,
          arrivalSeconds,
          deltaSeconds,
          windowStartSeconds: parseTimeWindowStartSeconds(detail.time_window),
        };
      })
      .filter(
        (detail) =>
          !!detail.flightId &&
          detail.arrivalSeconds !== null &&
          detail.arrivalSeconds >= windowFrom &&
          detail.arrivalSeconds <= windowTo
      )
      .sort((a, b) => Math.abs(a.deltaSeconds || 0) - Math.abs(b.deltaSeconds || 0));

    const out: Array<{ flightId: string; sortMetric: FlightSortMetric }> = [];
    const seen = new Set<string>();
    for (const detail of filteredDetails) {
      if (seen.has(detail.flightId)) continue;
      seen.add(detail.flightId);
      out.push({
        flightId: detail.flightId,
        sortMetric: {
          flightId: detail.flightId,
          perTv: {
            [primaryTvId]: {
              arrivalSeconds: detail.arrivalSeconds,
              deltaSeconds: detail.deltaSeconds,
              windowStartSeconds: detail.windowStartSeconds,
            },
          },
        },
      });
    }
    return out;
  }

  const candidates: Array<{ flightId: string; windowStartSeconds: number | null }> = [];
  const seen = new Set<string>();
  for (const [window, ids] of Object.entries(payload.data || {})) {
    const windowStart = parseTimeWindowStartSeconds(window);
    if (windowStart === null || windowStart < windowFrom || windowStart > windowTo) continue;
    for (const rawId of ids || []) {
      const flightId = String(rawId ?? "").trim();
      if (!flightId || seen.has(flightId)) continue;
      seen.add(flightId);
      candidates.push({ flightId, windowStartSeconds: windowStart });
    }
  }

  candidates.sort((a, b) => {
    const aStart = a.windowStartSeconds ?? Number.POSITIVE_INFINITY;
    const bStart = b.windowStartSeconds ?? Number.POSITIVE_INFINITY;
    if (aStart !== bStart) return aStart - bStart;
    return a.flightId.localeCompare(b.flightId);
  });

  return candidates.map((candidate) => ({
    flightId: candidate.flightId,
    sortMetric: {
      flightId: candidate.flightId,
      perTv: {
        [primaryTvId]: {
          arrivalSeconds: null,
          deltaSeconds: null,
          windowStartSeconds: candidate.windowStartSeconds,
        },
      },
    },
  }));
}

function parseTimeWindowStartSeconds(timeWindow: string): number | null {
  try {
    const [start = ""] = String(timeWindow || "").split("-");
    const [h = 0, m = 0] = start.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 3600 + m * 60;
  } catch {
    return null;
  }
}

function parseHHMMSSToSeconds(value: string): number | null {
  const match = String(value || "").match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const h = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  const s = Number.parseInt(match[3] || "0", 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  return h * 3600 + m * 60 + s;
}

function normalizeTimeWindow(
  window: [number, number],
  fallbackStart: number
): { from: number; to: number } {
  const from = Number(window?.[0]);
  const to = Number(window?.[1]);
  if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
    return { from: Math.floor(from), to: Math.floor(to) };
  }
  const start = Number.isFinite(fallbackStart) ? Math.floor(fallbackStart) : 0;
  return { from: start, to: start + 3600 };
}

function formatTimeForAPI(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  return `${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}${String(secs).padStart(2, "0")}`;
}
