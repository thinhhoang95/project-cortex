import { describe, expect, it } from "vitest";

import { computeBottomControlsCenterOffset } from "@/components/useBottomControlsAutoPosition";

describe("computeBottomControlsCenterOffset", () => {
  it("stays centered when no side panes are visible", () => {
    expect(
      computeBottomControlsCenterOffset({
        controlWidth: 520,
        viewportWidth: 1440,
        panes: [],
      }),
    ).toBe(0);
  });

  it("recenters within the remaining space when only the left pane is visible", () => {
    expect(
      computeBottomControlsCenterOffset({
        controlWidth: 520,
        viewportWidth: 1200,
        panes: [{ side: "left", left: 16, right: 376 }],
      }),
    ).toBe(188);
  });

  it("moves left as additional right-side panes widen the blocked area", () => {
    expect(
      computeBottomControlsCenterOffset({
        controlWidth: 520,
        viewportWidth: 1200,
        panes: [
          { side: "left", left: 16, right: 376 },
          { side: "right", left: 800, right: 1184 },
        ],
      }),
    ).toBe(-12);

    expect(
      computeBottomControlsCenterOffset({
        controlWidth: 520,
        viewportWidth: 1200,
        panes: [
          { side: "left", left: 16, right: 376 },
          { side: "right", left: 460, right: 1184 },
        ],
      }),
    ).toBe(-182);
  });

  it("clamps back to center when the control is wider than the viewport allowance", () => {
    expect(
      computeBottomControlsCenterOffset({
        controlWidth: 1200,
        viewportWidth: 1100,
        panes: [{ side: "left", left: 16, right: 376 }],
      }),
    ).toBe(0);
  });
});
