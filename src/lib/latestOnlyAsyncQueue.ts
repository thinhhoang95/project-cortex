export interface LatestOnlyAsyncQueue<T> {
  enqueue(item: T): void;
  clear(): void;
  dispose(): void;
}

export function createLatestOnlyAsyncQueue<T>(
  processor: (item: T) => Promise<void>,
): LatestOnlyAsyncQueue<T> {
  let disposed = false;
  let inFlight = false;
  let hasPending = false;
  let pendingItem: T | null = null;

  const run = async (item: T): Promise<void> => {
    inFlight = true;
    try {
      await processor(item);
    } finally {
      if (disposed) {
        inFlight = false;
        hasPending = false;
        pendingItem = null;
        return;
      }

      if (hasPending && pendingItem !== null) {
        const nextItem = pendingItem;
        hasPending = false;
        pendingItem = null;
        void run(nextItem);
        return;
      }

      inFlight = false;
    }
  };

  return {
    enqueue(item: T) {
      if (disposed) return;
      if (inFlight) {
        pendingItem = item;
        hasPending = true;
        return;
      }
      void run(item);
    },
    clear() {
      hasPending = false;
      pendingItem = null;
    },
    dispose() {
      disposed = true;
      hasPending = false;
      pendingItem = null;
    },
  };
}
