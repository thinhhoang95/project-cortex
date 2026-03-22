"use client";

import type { RegulationProposal, ProposalFlow } from "@/lib/regulationProposals";
import type { RegulationContext } from "@/lib/regulationTargets";

export type ProposalRegulationSource = {
  kind: "proposal";
  proposalId: string;
  flowId: string | null;
};

export type ProposalDerivedRegulationDraft = {
  trafficVolume: string;
  activeTimeWindowFrom: number;
  activeTimeWindowTo: number;
  flightIds: string[];
  resourceDate: string | null;
  resourceStateId: string | null;
  rate: number;
  proposalSource: ProposalRegulationSource;
};

type TimeRange = {
  from: number;
  to: number;
};

type BuildDraftParams = {
  proposal: RegulationProposal;
  flow: ProposalFlow;
  currentContext: RegulationContext;
  fallbackQueryTimeWindow?: string | null;
  selectedFlightIds?: Iterable<string> | null;
};

function normalizeFlightIds(ids: Iterable<string> | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids || []) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function parseClockToSeconds(raw: string): number | null {
  const value = String(raw ?? "").trim();
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] != null ? Number(match[3]) : 0;
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function parseTimeRange(label: string | null | undefined): TimeRange | null {
  if (!label) return null;
  const match = String(label).match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[–-]\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (!match) return null;
  const from = parseClockToSeconds(match[1]);
  const to = parseClockToSeconds(match[2]);
  if (from == null || to == null) return null;
  if (to <= from) return null;
  return { from, to };
}

function resolveTrafficVolume(proposal: RegulationProposal, flow: ProposalFlow): string | null {
  const flowTv = String(flow.control_volume_id ?? "").trim();
  if (flowTv) return flowTv;
  const hotspotTv = String(proposal.hotspot?.traffic_volume_id ?? "").trim();
  if (hotspotTv) return hotspotTv;
  return null;
}

function resolveTimeRange(
  proposal: RegulationProposal,
  flow: ProposalFlow,
  fallbackQueryTimeWindow?: string | null,
): TimeRange | null {
  return (
    parseTimeRange(flow.time_window_label) ||
    parseTimeRange(proposal.control_window?.label) ||
    parseTimeRange(fallbackQueryTimeWindow)
  );
}

export function buildRegulationDraftFromProposalFlow({
  proposal,
  flow,
  currentContext,
  fallbackQueryTimeWindow,
  selectedFlightIds,
}: BuildDraftParams): ProposalDerivedRegulationDraft {
  if (!currentContext.resourceDate) {
    throw new Error("The current resource date is unavailable. Refusing to create a regulation without resource context.");
  }

  const trafficVolume = resolveTrafficVolume(proposal, flow);
  if (!trafficVolume) {
    throw new Error(`Proposal ${proposal.id} flow ${flow.flow_id} is missing a control volume.`);
  }

  const timeRange = resolveTimeRange(proposal, flow, fallbackQueryTimeWindow);
  if (!timeRange) {
    throw new Error(`Proposal ${proposal.id} flow ${flow.flow_id} is missing a valid time window.`);
  }

  const allowedFlights = new Set(normalizeFlightIds(flow.flight_ids || []));
  const selected = normalizeFlightIds(selectedFlightIds);
  const flightIds = selected.length > 0
    ? selected.filter((id) => allowedFlights.has(id))
    : Array.from(allowedFlights);
  if (flightIds.length === 0) {
    throw new Error(`Proposal ${proposal.id} flow ${flow.flow_id} has no target flights to add.`);
  }

  return {
    trafficVolume,
    activeTimeWindowFrom: timeRange.from,
    activeTimeWindowTo: timeRange.to,
    flightIds,
    resourceDate: currentContext.resourceDate,
    resourceStateId: currentContext.resourceStateId,
    rate: Number.isFinite(flow.allowed_rate_per_hour) ? flow.allowed_rate_per_hour : 0,
    proposalSource: {
      kind: "proposal",
      proposalId: proposal.id,
      flowId: String(flow.flow_id),
    },
  };
}
