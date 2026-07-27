import { describe, expect, it } from "vitest";
import {
  buildAgentRunKey,
  normalizeAgentRunMethodology,
  toAgentRunRef,
} from "@/lib/agentRuns";

describe("agentRuns", () => {
  it("normalizes supported methodologies", () => {
    expect(normalizeAgentRunMethodology("RZ")).toBe("rz");
    expect(normalizeAgentRunMethodology("sa")).toBe("sa");
    expect(normalizeAgentRunMethodology("GA")).toBe("ga");
    expect(normalizeAgentRunMethodology("other")).toBeNull();
  });

  it("builds stable composite run keys", () => {
    expect(buildAgentRunKey("rz", "run_1")).toBe("rz:run_1");
    expect(buildAgentRunKey("sa", "run_1")).toBe("sa:run_1");
    expect(buildAgentRunKey("ga", "run_1")).toBe("ga:run_1");
  });

  it("creates a run ref only when both run id and methodology are valid", () => {
    expect(
      toAgentRunRef({ run_id: "run_7", methodology: "sa" }),
    ).toEqual({
      runId: "run_7",
      methodology: "sa",
      runKey: "sa:run_7",
    });

    expect(toAgentRunRef({ run_id: "run_7", methodology: "invalid" })).toBeNull();
    expect(toAgentRunRef({ run_id: "", methodology: "rz" })).toBeNull();
  });
});
