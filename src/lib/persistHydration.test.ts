import { describe, expect, it, vi } from "vitest";

import { waitForPersistHydration } from "@/lib/persistHydration";

describe("persistHydration", () => {
  it("resolves immediately once the store is already hydrated", async () => {
    const onFinishHydration = vi.fn();

    await expect(
      waitForPersistHydration({
        hasHydrated: () => true,
        onFinishHydration,
      }),
    ).resolves.toBeUndefined();

    expect(onFinishHydration).not.toHaveBeenCalled();
  });

  it("waits for hydration and unsubscribes after completion", async () => {
    let finishHydration: (() => void) | null = null;
    const unsubscribe = vi.fn();
    const onFinishHydration = vi.fn((listener: () => void) => {
      finishHydration = listener;
      return unsubscribe;
    });

    const promise = waitForPersistHydration({
      hasHydrated: () => false,
      onFinishHydration,
    });

    expect(onFinishHydration).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    finishHydration?.();

    await expect(promise).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
