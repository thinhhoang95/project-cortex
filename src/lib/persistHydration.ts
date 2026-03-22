export type PersistHydrationHandle = {
  hasHydrated: () => boolean;
  onFinishHydration: (listener: () => void) => () => void;
};

export function waitForPersistHydration(persist: PersistHydrationHandle): Promise<void> {
  if (persist.hasHydrated()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const unsubscribe = persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}
