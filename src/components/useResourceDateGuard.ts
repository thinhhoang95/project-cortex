"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useSimStore } from "@/components/useSimStore";
import { fetchResourceContext } from "@/lib/resourceContextClient";
import { isResourceDateReady } from "@/lib/resourceDates";

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
          clearResourceDate();
          router.replace("/select-date?reason=invalid");
          return;
        }

        if (context.selected_date !== resourceDate) {
          clearResourceDate();
          router.replace("/select-date?reason=out_of_sync");
          return;
        }

        setReady(true);
      } catch (error) {
        console.error("Failed to validate resource date:", error);
        if (cancelled) return;
        clearResourceDate();
        router.replace("/select-date?reason=invalid");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowMissingResourceDate, clearResourceDate, hydrated, pathname, resourceDate, router, user]);

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
