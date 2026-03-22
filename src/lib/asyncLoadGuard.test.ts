import { describe, expect, it } from "vitest";

import { createAsyncLoadGuard } from "@/lib/asyncLoadGuard";

describe("asyncLoadGuard", () => {
  it("tracks the current scope predicate", () => {
    let active = true;
    const guard = createAsyncLoadGuard(() => active);

    expect(guard.isActive()).toBe(true);

    active = false;
    expect(guard.isActive()).toBe(false);
  });

  it("stays inactive after cancellation", () => {
    const guard = createAsyncLoadGuard(() => true);

    expect(guard.isActive()).toBe(true);

    guard.cancel();

    expect(guard.isActive()).toBe(false);
  });
});
