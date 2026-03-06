import { beforeEach, describe, expect, it } from "vitest";

import { useSimStore } from "./useSimStore";

describe("useSimStore resourceDate", () => {
  beforeEach(() => {
    useSimStore.getState().clearResourceDate();
    useSimStore.getState().resetAll();
  });

  it("stores the canonical ISO resource date", () => {
    useSimStore.getState().setResourceDate("2023-07-17");
    expect(useSimStore.getState().resourceDate).toBe("2023-07-17");
  });

  it("preserves resourceDate across resetAll", () => {
    useSimStore.getState().setResourceDate("2023-07-17");
    useSimStore.getState().setShowFlightLines(false);

    useSimStore.getState().resetAll();

    expect(useSimStore.getState().resourceDate).toBe("2023-07-17");
    expect(useSimStore.getState().showFlightLines).toBe(true);
  });

  it("can clear an invalid persisted resource date", () => {
    useSimStore.getState().setResourceDate("2023-07-17");
    useSimStore.getState().clearResourceDate();
    expect(useSimStore.getState().resourceDate).toBeNull();
  });
});
