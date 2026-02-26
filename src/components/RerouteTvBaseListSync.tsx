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
    setRerouteBaseFlightIds,
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

  useEffect(() => {
    if (airspaceDisplayMode !== "tv") return;
    if (!selectedTvIds.length) return;

    const reqId = ++requestSeq.current;
    const refTime = formatTimeForAPI(useSimStore.getState().t);

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
        const orderedFlightIds = buildBaseListForSelection(selectedTvIds, payloadByTv);
        setRerouteBaseFlightIds(orderedFlightIds, "tv");
      })
      .catch((error) => {
        if (reqId !== requestSeq.current) return;
        console.error("Failed to synchronize reroute base list from selected TVs:", error);
      });
  }, [airspaceDisplayMode, selectedTvKey, selectedTvIds, setRerouteBaseFlightIds]);

  return null;
}

function buildBaseListForSelection(
  selectedTvIds: string[],
  payloadByTv: Record<string, TvFlightsPayload>
): string[] {
  if (selectedTvIds.length === 0) return [];

  if (selectedTvIds.length === 1) {
    return buildSingleTvBaseList(payloadByTv[selectedTvIds[0]]);
  }

  const membershipSets: Array<Set<string>> = [];
  const sortMetricsByFlight = new Map<string, FlightSortMetric["perTv"]>();

  for (const tvId of selectedTvIds) {
    const payload = payloadByTv[tvId];
    if (!payload) return [];

    if (payload.kind === "ordered") {
      const membership = new Set<string>();
      for (const raw of payload.data.ordered_flights || []) {
        const id = String(raw ?? "").trim();
        if (!id) continue;
        membership.add(id);
        ensureMetric(sortMetricsByFlight, id, tvId, {
          arrivalSeconds: null,
          deltaSeconds: null,
          windowStartSeconds: null,
        });
      }

      for (const detail of payload.data.details || []) {
        const id = String(detail.flight_id ?? "").trim();
        if (!id) continue;
        membership.add(id);
        ensureMetric(sortMetricsByFlight, id, tvId, {
          arrivalSeconds:
            typeof detail.arrival_seconds === "number" && Number.isFinite(detail.arrival_seconds)
              ? detail.arrival_seconds
              : null,
          deltaSeconds:
            typeof detail.delta_seconds === "number" && Number.isFinite(detail.delta_seconds)
              ? detail.delta_seconds
              : null,
          windowStartSeconds: parseTimeWindowStartSeconds(detail.time_window),
        });
      }

      membershipSets.push(membership);
      continue;
    }

    const membership = new Set<string>();
    const earliestWindowStart = new Map<string, number | null>();

    for (const [window, ids] of Object.entries(payload.data || {})) {
      const windowStart = parseTimeWindowStartSeconds(window);
      for (const rawId of ids || []) {
        const id = String(rawId ?? "").trim();
        if (!id) continue;

        membership.add(id);
        const prev = earliestWindowStart.get(id);
        if (
          !earliestWindowStart.has(id) ||
          (windowStart !== null && (prev === null || prev === undefined || windowStart < prev))
        ) {
          earliestWindowStart.set(id, windowStart);
        }
      }
    }

    for (const [id, windowStart] of earliestWindowStart.entries()) {
      ensureMetric(sortMetricsByFlight, id, tvId, {
        arrivalSeconds: null,
        deltaSeconds: null,
        windowStartSeconds: windowStart,
      });
    }

    membershipSets.push(membership);
  }

  const intersection = intersectStringSets(membershipSets);
  const primaryTvId = selectedTvIds[0] ?? null;

  const sortableRows: FlightSortMetric[] = Array.from(intersection).map((flightId) => {
    const perTv: FlightSortMetric["perTv"] = {};
    for (const tvId of selectedTvIds) {
      perTv[tvId] =
        sortMetricsByFlight.get(flightId)?.[tvId] || {
          arrivalSeconds: null,
          deltaSeconds: null,
          windowStartSeconds: null,
        };
    }
    return { flightId, perTv };
  });

  sortableRows.sort((a, b) => compareIntersectionFlightRows(a, b, primaryTvId));
  return sortableRows.map((row) => row.flightId);
}

function buildSingleTvBaseList(payload: TvFlightsPayload | undefined): string[] {
  if (!payload) return [];

  if (payload.kind === "ordered") {
    const ordered = uniqueNormalized(payload.data.ordered_flights || []);
    if (ordered.length > 0) return ordered;
    return uniqueNormalized((payload.data.details || []).map((detail) => detail.flight_id));
  }

  const windows = Object.entries(payload.data || {}).sort((a, b) => {
    const aStart = parseTimeWindowStartSeconds(a[0]);
    const bStart = parseTimeWindowStartSeconds(b[0]);
    if (aStart === null && bStart === null) return 0;
    if (aStart === null) return 1;
    if (bStart === null) return -1;
    return aStart - bStart;
  });

  const flattened: string[] = [];
  for (const [, ids] of windows) {
    for (const id of ids || []) {
      flattened.push(String(id ?? ""));
    }
  }

  return uniqueNormalized(flattened);
}

function ensureMetric(
  map: Map<string, FlightSortMetric["perTv"]>,
  flightId: string,
  tvId: string,
  metric: FlightSortMetric["perTv"][string]
) {
  const existing = map.get(flightId) || {};
  existing[tvId] = metric;
  map.set(flightId, existing);
}

function uniqueNormalized(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
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

function formatTimeForAPI(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  return `${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}${String(secs).padStart(2, "0")}`;
}
