import { authFetch } from "@/lib/auth";

export type FlowTraceVolume = {
  traffic_volume_id: string;
  first_bin?: number | null;
  last_bin?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  flight_count?: number | null;
};

export type FlowTraceResponse = {
  flight_ids: string[];
  time_bin_minutes?: number;
  volume_ids: string[];
  volumes: FlowTraceVolume[];
  count?: number;
  metadata?: Record<string, unknown> | null;
};

const traceCache = new Map<string, Promise<FlowTraceResponse>>();

export function normalizeTraceFlightIds(flightIds: Iterable<string> | null | undefined): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rawId of flightIds || []) {
    const id = String(rawId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function cacheKeyForFlightIds(flightIds: string[]): string {
  return flightIds.slice().sort().join("\u0000");
}

export async function fetchFlowTrace(flightIds: Iterable<string> | null | undefined): Promise<FlowTraceResponse> {
  const ids = normalizeTraceFlightIds(flightIds);
  if (ids.length === 0) {
    return {
      flight_ids: [],
      volume_ids: [],
      volumes: [],
      count: 0,
      metadata: { num_input_flights: 0, missing_flight_ids: [] },
    };
  }

  const key = cacheKeyForFlightIds(ids);
  const cached = traceCache.get(key);
  if (cached) return cached;

  const request = authFetch("/api/flow_trace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      flight_ids: ids,
      scope: "visited_footprint",
    }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const message = await response.text().catch(() => "Failed to fetch flow trace");
        throw new Error(message || "Failed to fetch flow trace");
      }
      const payload = await response.json();
      const volumeIds = Array.isArray(payload?.volume_ids)
        ? payload.volume_ids.map((id: unknown) => String(id ?? "").trim()).filter(Boolean)
        : [];
      const volumes = Array.isArray(payload?.volumes)
        ? payload.volumes
            .map((volume: any) => {
              const trafficVolumeId = String(volume?.traffic_volume_id ?? "").trim();
              if (!trafficVolumeId) return null;
              return {
                traffic_volume_id: trafficVolumeId,
                first_bin: typeof volume?.first_bin === "number" ? volume.first_bin : null,
                last_bin: typeof volume?.last_bin === "number" ? volume.last_bin : null,
                start_time: typeof volume?.start_time === "string" ? volume.start_time : null,
                end_time: typeof volume?.end_time === "string" ? volume.end_time : null,
                flight_count: typeof volume?.flight_count === "number" ? volume.flight_count : null,
              } satisfies FlowTraceVolume;
            })
            .filter(Boolean) as FlowTraceVolume[]
        : [];
      return {
        flight_ids: Array.isArray(payload?.flight_ids) ? normalizeTraceFlightIds(payload.flight_ids) : ids,
        time_bin_minutes: typeof payload?.time_bin_minutes === "number" ? payload.time_bin_minutes : undefined,
        volume_ids: volumeIds.length > 0 ? volumeIds : volumes.map((volume) => volume.traffic_volume_id),
        volumes,
        count: typeof payload?.count === "number" ? payload.count : volumeIds.length,
        metadata: payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : null,
      };
    })
    .catch((error) => {
      traceCache.delete(key);
      throw error;
    });

  traceCache.set(key, request);
  return request;
}

export function clearFlowTraceCache(): void {
  traceCache.clear();
}
