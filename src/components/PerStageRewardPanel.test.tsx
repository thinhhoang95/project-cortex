import { describe, expect, it } from "vitest";
import { normalizePerStageRewardRows } from "@/components/PerStageRewardPanel";

describe("normalizePerStageRewardRows", () => {
  it("sorts rows, filters invalid entries, and marks the selected step", () => {
    const rows = normalizePerStageRewardRows(
      [
        { step_number: 3, reward: 2.5, control_volume: "TV3", time_window: "11:00-11:15" },
        { step_number: "2", reward: "5.25", control_volume: "TV2" },
        { step_number: 1, reward: Number.NaN },
        { step_number: null, reward: 8 },
      ],
      2,
    );

    expect(rows).toEqual([
      {
        step: 2,
        reward: 5.25,
        controlVolume: "TV2",
        timeWindow: null,
        proposalRank: null,
        isSelected: true,
      },
      {
        step: 3,
        reward: 2.5,
        controlVolume: "TV3",
        timeWindow: "11:00-11:15",
        proposalRank: null,
        isSelected: false,
      },
    ]);
  });

  it("returns an empty array for missing or unusable reward payloads", () => {
    expect(normalizePerStageRewardRows(null, 1)).toEqual([]);
    expect(
      normalizePerStageRewardRows(
        [
          { step_number: 0, reward: 2 },
          { step_number: 1, reward: undefined },
          { step_number: "bad", reward: "3" },
        ],
        1,
      ),
    ).toEqual([]);
  });
});
