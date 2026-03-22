"use client";

import type { Trajectory } from "@/lib/models";

export type RegulationContext = {
  resourceDate: string | null;
  resourceStateId: string | null;
};

type RegulationTargetRecord = {
  flightIds?: unknown;
  flightCallsigns?: unknown;
  resourceDate?: unknown;
  resourceStateId?: unknown;
};

export function normalizeFlightIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const id = String(value ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function normalizeLegacyFlightTokenList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const token = String(value ?? "").trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

export function getRegulationFlightIds(record: RegulationTargetRecord | null | undefined): string[] {
  return normalizeFlightIdList(record?.flightIds);
}

export function getLegacyRegulationFlightTokens(record: RegulationTargetRecord | null | undefined): string[] {
  return normalizeLegacyFlightTokenList(record?.flightCallsigns);
}

export function getRegulationTargetCount(record: RegulationTargetRecord | null | undefined): number {
  const ids = getRegulationFlightIds(record);
  if (ids.length > 0) return ids.length;
  return getLegacyRegulationFlightTokens(record).length;
}

export function normalizeRegulationContext(raw: Partial<RegulationContext> | null | undefined): RegulationContext {
  const resourceDateValue = raw?.resourceDate;
  const resourceStateIdValue = raw?.resourceStateId;
  return {
    resourceDate:
      typeof resourceDateValue === "string" && resourceDateValue.trim().length > 0
        ? resourceDateValue.trim()
        : null,
    resourceStateId:
      typeof resourceStateIdValue === "string" && resourceStateIdValue.trim().length > 0
        ? resourceStateIdValue.trim()
        : null,
  };
}

export function getRegulationContext(record: RegulationTargetRecord | null | undefined): RegulationContext {
  return normalizeRegulationContext({
    resourceDate: record?.resourceDate as string | null | undefined,
    resourceStateId: record?.resourceStateId as string | null | undefined,
  });
}

export function sameRegulationContext(a: RegulationContext, b: RegulationContext): boolean {
  return a.resourceDate === b.resourceDate && a.resourceStateId === b.resourceStateId;
}

export function describeRegulationContext(context: RegulationContext): string {
  const dateLabel = context.resourceDate ?? "unknown date";
  const stateLabel = context.resourceStateId ? `state ${context.resourceStateId}` : "base state";
  return `${dateLabel} / ${stateLabel}`;
}

export function assertReplayableRegulationTargets(
  record: RegulationTargetRecord | null | undefined,
  currentContext?: RegulationContext,
): string[] {
  const ids = getRegulationFlightIds(record);
  if (ids.length === 0) {
    const legacyTokens = getLegacyRegulationFlightTokens(record);
    if (legacyTokens.length > 0) {
      throw new Error(
        "This regulation uses legacy callsign targets and cannot be replayed safely. Recreate it from the current flight list.",
      );
    }
    throw new Error("This regulation has no target flight IDs.");
  }

  const recordContext = getRegulationContext(record);
  if (!recordContext.resourceDate) {
    throw new Error(
      "This regulation is missing its resource date and cannot be replayed safely. Recreate it from the current flight list.",
    );
  }

  if (!sameRegulationContext(recordContext, normalizeRegulationContext(currentContext))) {
    if (currentContext) {
      throw new Error(
        `This regulation belongs to ${describeRegulationContext(recordContext)}, but the current workspace is ${describeRegulationContext(
          normalizeRegulationContext(currentContext),
        )}. Switch back to the original resource state before editing or simulating it.`,
      );
    }
    throw new Error(
      `This regulation belongs to ${describeRegulationContext(recordContext)}.`,
    );
  }

  return ids;
}

export function resolveRegulationTargetLabels(
  record: RegulationTargetRecord | null | undefined,
  flights: Trajectory[],
): string[] {
  const ids = getRegulationFlightIds(record);
  if (ids.length > 0) {
    const flightsById = new Map<string, Trajectory>();
    for (const flight of flights) {
      const id = String(flight?.flightId ?? "").trim();
      if (!id) continue;
      flightsById.set(id, flight);
    }
    return ids.map((id) => {
      const flight = flightsById.get(id);
      const callSign = String(flight?.callSign ?? "").trim();
      return callSign || id;
    });
  }
  return getLegacyRegulationFlightTokens(record);
}
