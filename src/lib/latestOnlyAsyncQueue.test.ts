import { describe, expect, it, vi } from "vitest";

import { createLatestOnlyAsyncQueue } from "./latestOnlyAsyncQueue";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("latestOnlyAsyncQueue", () => {
  it("runs at most one task at a time and keeps only the latest pending item", async () => {
    const started: string[] = [];
    const resolvers = new Map<string, () => void>();

    const queue = createLatestOnlyAsyncQueue<string>(async (item) => {
      started.push(item);
      await new Promise<void>((resolve) => {
        resolvers.set(item, resolve);
      });
    });

    queue.enqueue("A");
    queue.enqueue("B");
    queue.enqueue("C");

    expect(started).toEqual(["A"]);

    resolvers.get("A")?.();
    await flushMicrotasks();

    expect(started).toEqual(["A", "C"]);

    resolvers.get("C")?.();
    await flushMicrotasks();
  });

  it("drops the pending item when cleared", async () => {
    const started: string[] = [];
    const resolvers = new Map<string, () => void>();

    const queue = createLatestOnlyAsyncQueue<string>(async (item) => {
      started.push(item);
      await new Promise<void>((resolve) => {
        resolvers.set(item, resolve);
      });
    });

    queue.enqueue("A");
    queue.enqueue("B");
    queue.clear();

    resolvers.get("A")?.();
    await flushMicrotasks();

    expect(started).toEqual(["A"]);
  });

  it("ignores new work after disposal", async () => {
    const processor = vi.fn(async (_item: string) => undefined);
    const queue = createLatestOnlyAsyncQueue(processor);

    queue.dispose();
    queue.enqueue("A");
    await flushMicrotasks();

    expect(processor).not.toHaveBeenCalled();
  });
});
