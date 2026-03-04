export type AgentRunMethodology = "rz" | "sa";

export interface AgentRunRef {
  runId: string;
  methodology: AgentRunMethodology;
  runKey: string;
}

export interface AgentSolListRun {
  run_id: string;
  methodology: AgentRunMethodology | string;
  best_total_improvement: number | null;
  status: "completed" | "ongoing" | string;
}

export function normalizeAgentRunMethodology(
  value: unknown,
): AgentRunMethodology | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "rz" || normalized === "sa") {
    return normalized;
  }
  return null;
}

export function buildAgentRunKey(
  methodology: AgentRunMethodology,
  runId: string,
): string {
  return `${methodology}:${runId}`;
}

export function createAgentRunRef(
  methodology: AgentRunMethodology,
  runId: string,
): AgentRunRef {
  return {
    runId,
    methodology,
    runKey: buildAgentRunKey(methodology, runId),
  };
}

export function toAgentRunRef(
  run:
    | {
        run_id?: string | null;
        runId?: string | null;
        methodology?: string | null;
      }
    | null
    | undefined,
): AgentRunRef | null {
  if (!run) return null;
  const methodology = normalizeAgentRunMethodology(run.methodology);
  const runId = typeof run.run_id === "string"
    ? run.run_id.trim()
    : typeof run.runId === "string"
      ? run.runId.trim()
      : "";

  if (!methodology || !runId) return null;
  return createAgentRunRef(methodology, runId);
}
