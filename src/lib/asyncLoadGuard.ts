export type AsyncLoadGuard = {
  isActive: () => boolean;
  cancel: () => void;
};

export function createAsyncLoadGuard(isCurrent: () => boolean): AsyncLoadGuard {
  let cancelled = false;

  return {
    isActive: () => !cancelled && isCurrent(),
    cancel: () => {
      cancelled = true;
    },
  };
}
