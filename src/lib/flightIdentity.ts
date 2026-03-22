"use client";

import type { Trajectory } from "@/lib/models";
import type { FlowBasketItem } from "@/components/useSimStore";

export function buildFlightIdIndex(flights: Trajectory[]): Map<string, Trajectory> {
  const byId = new Map<string, Trajectory>();
  for (const flight of flights || []) {
    const id = String(flight?.flightId ?? "").trim();
    if (!id) continue;
    byId.set(id, flight);
  }
  return byId;
}

export function buildUniqueCallsignIndex(flights: Trajectory[]): Map<string, string | null> {
  const byCallsign = new Map<string, string | null>();
  for (const flight of flights || []) {
    const id = String(flight?.flightId ?? "").trim();
    const callSign = String(flight?.callSign ?? "").trim();
    if (!id || !callSign) continue;
    if (!byCallsign.has(callSign)) {
      byCallsign.set(callSign, id);
      continue;
    }
    const existing = byCallsign.get(callSign);
    if (existing !== id) {
      byCallsign.set(callSign, null);
    }
  }
  return byCallsign;
}

export function resolveFlightTokenToIdStrict(token: string, flights: Trajectory[]): string {
  const normalized = String(token ?? "").trim();
  if (!normalized) {
    throw new Error("Flight identifier is empty.");
  }

  const byId = buildFlightIdIndex(flights);
  if (byId.has(normalized)) {
    return normalized;
  }

  const byCallsign = buildUniqueCallsignIndex(flights);
  if (!byCallsign.has(normalized)) {
    throw new Error(`Flight "${normalized}" does not exist in the current workspace.`);
  }

  const resolvedId = byCallsign.get(normalized);
  if (!resolvedId) {
    throw new Error(`Callsign "${normalized}" is ambiguous in the current workspace. Use the flight ID instead.`);
  }

  return resolvedId;
}

export function normalizeFlowBasketItemsStrict(
  items: Array<string | FlowBasketItem> | undefined,
  flights: Trajectory[],
): FlowBasketItem[] {
  const byKey = new Map<string, FlowBasketItem>();
  for (const rawItem of items || []) {
    if (typeof rawItem === "string") {
      const key = resolveFlightTokenToIdStrict(rawItem, flights);
      byKey.set(key, { key });
      continue;
    }
    if (!rawItem || typeof rawItem !== "object" || !("key" in rawItem)) {
      continue;
    }
    const key = resolveFlightTokenToIdStrict(String((rawItem as any).key), flights);
    const prev = byKey.get(key) || { key };
    byKey.set(key, { ...prev, ...rawItem, key });
  }
  return Array.from(byKey.values());
}
