"use client";

import { authFetch } from "@/lib/auth";

const MAX_COUNT_CACHE_ENTRIES = 12;
const MAX_FLIGHT_CACHE_ENTRIES = 24;
const countRequests = new Map<string, Promise<unknown>>();
const flightRequests = new Map<string, Promise<unknown>>();

function remember<T>(
  cache: Map<string, Promise<unknown>>,
  key: string,
  request: Promise<T>,
  maxEntries: number,
): Promise<T> {
  cache.set(key, request);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    cache.delete(oldestKey);
  }
  request.catch(() => {
    if (cache.get(key) === request) cache.delete(key);
  });
  return request;
}

async function fetchJson<T>(url: string, fallbackMessage: string): Promise<T> {
  const response = await authFetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || payload?.detail || `${fallbackMessage} (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function fetchTvCountWithCapacity<T>({
  trafficVolumeId,
  resourceStateEpoch,
}: {
  trafficVolumeId: string;
  resourceStateEpoch: number;
}): Promise<T> {
  const tvId = String(trafficVolumeId).trim();
  const key = `${resourceStateEpoch}|${tvId}`;
  const cached = countRequests.get(key);
  if (cached) return cached as Promise<T>;

  return remember(
    countRequests,
    key,
    fetchJson<T>(
      `/api/tv_count_with_capacity?traffic_volume_id=${encodeURIComponent(tvId)}`,
      "Failed to fetch occupancy data",
    ),
    MAX_COUNT_CACHE_ENTRIES,
  );
}

export function fetchTvFlights<T>({
  trafficVolumeId,
  refTimeStr,
  resourceStateEpoch,
}: {
  trafficVolumeId: string;
  refTimeStr: string;
  resourceStateEpoch: number;
}): Promise<T> {
  const tvId = String(trafficVolumeId).trim();
  const ref = String(refTimeStr).trim();
  const key = `${resourceStateEpoch}|${tvId}|${ref}`;
  const cached = flightRequests.get(key);
  if (cached) return cached as Promise<T>;

  return remember(
    flightRequests,
    key,
    fetchJson<T>(
      `/api/tv_flights?traffic_volume_id=${encodeURIComponent(tvId)}&ref_time_str=${encodeURIComponent(ref)}`,
      "Failed to fetch flight data",
    ),
    MAX_FLIGHT_CACHE_ENTRIES,
  );
}

export function floorToTvTimeBin(seconds: number, binSeconds = 15 * 60): number {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const safeBinSeconds = Number.isFinite(binSeconds) && binSeconds > 0 ? binSeconds : 15 * 60;
  return Math.floor(safeSeconds / safeBinSeconds) * safeBinSeconds;
}

export function clearTvApiCache(): void {
  countRequests.clear();
  flightRequests.clear();
}
