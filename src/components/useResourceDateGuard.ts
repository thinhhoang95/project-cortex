"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useSimStore } from "@/components/useSimStore";
import { fetchResourceContext, fetchResourceStateHistory } from "@/lib/resourceContextClient";
import { isResourceDateReady } from "@/lib/resourceDates";
import { buildResourceStateSyncPayload, validateResourceStateBundleDate } from "@/lib/resourceStates";

type UseResourceDateGuardOptions = {
  allowMissingResourceDate?: boolean;
};

export function useResourceDateGuard(options: UseResourceDateGuardOptions = {}) {
  const allowMissingResourceDate = options.allowMissingResourceDate ?? false;
  const router = useRouter();
  const pathname = usePathname();
  const user = useSimStore((state) => state.user);
  const resourceDate = useSimStore((state) => state.resourceDate);
  const clearResourceDate = useSimStore((state) => state.clearResourceDate);
  const clearResourceState = useSimStore((state) => state.clearResourceState);
  const setResourceStateError = useSimStore((state) => state.setResourceStateError);
  const setResourceStateLoading = useSimStore((state) => state.setResourceStateLoading);
  const syncResourceState = useSimStore((state) => state.syncResourceState);
  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = useSimStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useSimStore.persist.hasHydrated());
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setReady(false);

    if (!user) {
      router.replace("/login");
      return;
    }

    if (allowMissingResourceDate) {
      setReady(true);
      return;
    }

    if (!resourceDate) {
      clearResourceState();
      clearResourceDate();
      router.replace("/select-date?reason=missing");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const context = await fetchResourceContext();
        if (cancelled) return;

        if (!isResourceDateReady(resourceDate, context)) {
          clearResourceState();
          clearResourceDate();
          router.replace("/select-date?reason=invalid");
          return;
        }

        if (context.selected_date !== resourceDate) {
          clearResourceState();
          clearResourceDate();
          router.replace("/select-date?reason=out_of_sync");
          return;
        }

        setResourceStateLoading(true);
        try {
          const history = await fetchResourceStateHistory();
          if (cancelled) return;
          const bundleDateValidation = validateResourceStateBundleDate(resourceDate, context, history);
          if (!bundleDateValidation.matches) {
            clearResourceState();
            clearResourceDate();
            router.replace("/select-date?reason=out_of_sync");
            return;
          }
          syncResourceState(buildResourceStateSyncPayload(context, history));
        } catch (resourceStateError) {
          console.error("Failed to sync resource state history:", resourceStateError);
          if (cancelled) return;
          syncResourceState(buildResourceStateSyncPayload(context, null));
          setResourceStateError(
            resourceStateError instanceof Error
              ? resourceStateError.message
              : "Failed to load resource state history",
          );
        }

        setReady(true);
      } catch (error) {
        console.error("Failed to validate resource date:", error);
        if (cancelled) return;
        clearResourceState();
        clearResourceDate();
        router.replace("/select-date?reason=invalid");
      } finally {
        if (!cancelled) {
          setResourceStateLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    allowMissingResourceDate,
    clearResourceDate,
    clearResourceState,
    hydrated,
    pathname,
    resourceDate,
    router,
    setResourceStateError,
    setResourceStateLoading,
    syncResourceState,
    user,
  ]);

  return useMemo(
    () => ({
      hydrated,
      ready: hydrated && !!user && ready,
      user,
      resourceDate,
    }),
    [hydrated, ready, resourceDate, user],
  );
}
