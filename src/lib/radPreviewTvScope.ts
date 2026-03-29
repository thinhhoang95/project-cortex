export interface OrderedTvFlightLevelRange {
  min_fl?: number | null;
  max_fl?: number | null;
  label?: string | null;
  scope?: string | null;
}

export interface OrderedTvFlightDetail {
  flight_id: string;
  arrival_time: string;
  arrival_seconds: number;
  delta_seconds: number;
  time_window: string;
  dwell_seconds?: number | null;
  flight_level_range?: OrderedTvFlightLevelRange | null;
}

export interface OrderedTvFlightsData {
  traffic_volume_id: string;
  ref_time_str: string;
  ordered_flights: string[];
  details: OrderedTvFlightDetail[];
}

export interface LegacyTvFlightsData {
  [timeWindow: string]: string[];
}

export type TvFlightsPayload =
  | { kind: "ordered"; data: OrderedTvFlightsData }
  | { kind: "legacy"; data: LegacyTvFlightsData };

type FlightIdentifier = string | number | null | undefined;

export function normalizeTvFlightsPayload(data: unknown): TvFlightsPayload {
  const record = (data ?? {}) as Record<string, unknown>;
  if (Array.isArray(record.ordered_flights) && Array.isArray(record.details)) {
    return { kind: "ordered", data: record as unknown as OrderedTvFlightsData };
  }
  return { kind: "legacy", data: record as LegacyTvFlightsData };
}

export function formatTvFlightsReferenceTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);
  return `${hours.toString().padStart(2, "0")}${minutes.toString().padStart(2, "0")}${secs
    .toString()
    .padStart(2, "0")}`;
}

export function getTvScopeWindowSeconds(windowLength: string): number {
  const normalized = String(windowLength ?? "").trim().toLowerCase();
  const numValue = Number.parseInt(normalized, 10);
  if (!Number.isFinite(numValue) || numValue <= 0) return 0;
  if (normalized.includes("h")) {
    return numValue * 3600;
  }
  return numValue * 60;
}

export function parseTvFlightWindowStartSeconds(timeWindow: string): number | null {
  try {
    const [startTime = ""] = String(timeWindow ?? "").split("-");
    const [hours = 0, minutes = 0] = startTime.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 3600 + minutes * 60;
  } catch {
    return null;
  }
}

function getOrderedPayloadFlightOrder(payload: OrderedTvFlightsData): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const candidates = payload.ordered_flights.length > 0
    ? payload.ordered_flights
    : payload.details.map((detail) => detail.flight_id);

  for (const rawId of candidates) {
    const flightId = String(rawId ?? "").trim();
    if (!flightId || seen.has(flightId)) continue;
    seen.add(flightId);
    ordered.push(flightId);
  }

  return ordered;
}

export function collectTvFlightIdsInWindow(
  payload: TvFlightsPayload | null | undefined,
  windowStartSeconds: number,
  windowSeconds: number,
): string[] {
  if (!payload || !Number.isFinite(windowStartSeconds) || !Number.isFinite(windowSeconds) || windowSeconds < 0) {
    return [];
  }

  const windowEndSeconds = windowStartSeconds + windowSeconds;
  const seen = new Set<string>();
  const scopedFlightIds: string[] = [];

  if (payload.kind === "ordered") {
    const detailByFlightId = new Map<string, OrderedTvFlightDetail>();
    for (const detail of payload.data.details ?? []) {
      const flightId = String(detail?.flight_id ?? "").trim();
      if (!flightId || detailByFlightId.has(flightId)) continue;
      detailByFlightId.set(flightId, detail);
    }

    for (const flightId of getOrderedPayloadFlightOrder(payload.data)) {
      const detail = detailByFlightId.get(flightId);
      const arrivalSeconds =
        detail && typeof detail.arrival_seconds === "number" && Number.isFinite(detail.arrival_seconds)
          ? detail.arrival_seconds
          : null;
      const fallbackWindowStart = detail?.time_window
        ? parseTvFlightWindowStartSeconds(detail.time_window)
        : null;
      const candidateSeconds = arrivalSeconds ?? fallbackWindowStart;
      if (candidateSeconds === null) continue;
      if (candidateSeconds < windowStartSeconds || candidateSeconds > windowEndSeconds || seen.has(flightId)) continue;
      seen.add(flightId);
      scopedFlightIds.push(flightId);
    }

    return scopedFlightIds;
  }

  for (const [timeWindow, rawIds] of Object.entries(payload.data ?? {})) {
    const windowCandidate = parseTvFlightWindowStartSeconds(timeWindow);
    if (windowCandidate === null || windowCandidate < windowStartSeconds || windowCandidate > windowEndSeconds) {
      continue;
    }

    for (const rawId of rawIds ?? []) {
      const flightId = String(rawId ?? "").trim();
      if (!flightId || seen.has(flightId)) continue;
      seen.add(flightId);
      scopedFlightIds.push(flightId);
    }
  }

  return scopedFlightIds;
}

export function intersectOrderedFlightIds(
  orderedFlightIds: Iterable<FlightIdentifier>,
  allowedFlightIds: Iterable<FlightIdentifier>,
): string[] {
  const allowed = new Set<string>();
  for (const rawId of allowedFlightIds) {
    const flightId = String(rawId ?? "").trim();
    if (!flightId) continue;
    allowed.add(flightId);
  }

  const seen = new Set<string>();
  const intersection: string[] = [];
  for (const rawId of orderedFlightIds) {
    const flightId = String(rawId ?? "").trim();
    if (!flightId || seen.has(flightId) || !allowed.has(flightId)) continue;
    seen.add(flightId);
    intersection.push(flightId);
  }

  return intersection;
}

export function areStringSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}
