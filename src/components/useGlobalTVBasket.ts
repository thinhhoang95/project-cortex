"use client";

import { useEffect, useMemo, useState } from "react";
import { useSimStore } from "@/components/useSimStore";
import { useGlobalTVBasketStore } from "@/components/useGlobalTVBasketStore";
import {
  buildGlobalTvBasketScope,
  type GlobalTvBasketScope,
} from "@/lib/globalTvBasket";
import {
  listTrafficVolumeIds,
  listTrafficVolumeIdsSync,
} from "@/lib/trafficVolumes";

export type UseGlobalTVBasketResult = GlobalTvBasketScope & {
  catalogIds: string[];
  catalogLoading: boolean;
  catalogError: string | null;
  pinnedTvIds: string[];
  searchQuery: string;
};

export function useGlobalTVBasket(
  contextIds: readonly string[] = [],
): UseGlobalTVBasketResult {
  const resourceDate = useSimStore((state) => state.resourceDate);
  const pinnedTvIds = useGlobalTVBasketStore((state) => state.pinnedTvIds);
  const searchQuery = useGlobalTVBasketStore((state) => state.searchQuery);
  const [catalogIds, setCatalogIds] = useState<string[]>(() => listTrafficVolumeIdsSync() ?? []);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    if (!resourceDate) {
      setCatalogIds([]);
      setCatalogLoading(false);
      return;
    }
    let cancelled = false;
    setCatalogIds(listTrafficVolumeIdsSync() ?? []);
    setCatalogLoading(true);
    setCatalogError(null);
    void listTrafficVolumeIds(resourceDate)
      .then((ids) => {
        if (!cancelled) setCatalogIds(ids);
      })
      .catch((error) => {
        if (cancelled) return;
        setCatalogIds([]);
        setCatalogError(error instanceof Error ? error.message : "Failed to load traffic volumes");
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resourceDate]);

  const scope = useMemo(
    () => buildGlobalTvBasketScope({
      catalogIds,
      contextIds,
      pinnedIds: pinnedTvIds,
      query: searchQuery,
    }),
    [catalogIds, contextIds, pinnedTvIds, searchQuery],
  );

  return {
    ...scope,
    catalogIds,
    catalogLoading,
    catalogError,
    pinnedTvIds,
    searchQuery,
  };
}
