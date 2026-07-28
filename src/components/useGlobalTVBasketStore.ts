"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dedupeTrafficVolumeIds } from "@/lib/globalTvBasket";

type GlobalTVBasketState = {
  pinnedTvIds: string[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  pinTv: (trafficVolumeId: string) => void;
  unpinTv: (trafficVolumeId: string) => void;
  togglePin: (trafficVolumeId: string) => void;
  pinAll: (trafficVolumeIds: string[]) => void;
  clearPins: () => void;
};

export const useGlobalTVBasketStore = create(
  persist<
    GlobalTVBasketState,
    [],
    [],
    Pick<GlobalTVBasketState, "pinnedTvIds" | "searchQuery">
  >(
    (set, get) => ({
      pinnedTvIds: [],
      searchQuery: "",
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      pinTv: (trafficVolumeId) =>
        set((state) => ({
          pinnedTvIds: dedupeTrafficVolumeIds([...state.pinnedTvIds, trafficVolumeId]),
        })),
      unpinTv: (trafficVolumeId) => {
        const key = String(trafficVolumeId ?? "").trim().toLocaleUpperCase();
        set((state) => ({
          pinnedTvIds: state.pinnedTvIds.filter((id) => id.toLocaleUpperCase() !== key),
        }));
      },
      togglePin: (trafficVolumeId) => {
        const normalized = String(trafficVolumeId ?? "").trim();
        if (!normalized) return;
        const key = normalized.toLocaleUpperCase();
        const exists = get().pinnedTvIds.some((id) => id.toLocaleUpperCase() === key);
        if (exists) get().unpinTv(normalized);
        else get().pinTv(normalized);
      },
      pinAll: (trafficVolumeIds) =>
        set((state) => ({
          pinnedTvIds: dedupeTrafficVolumeIds([
            ...state.pinnedTvIds,
            ...trafficVolumeIds,
          ]),
        })),
      clearPins: () => set({ pinnedTvIds: [] }),
    }),
    {
      name: "cortex-global-tv-basket",
      version: 1,
      partialize: (state) => ({
        pinnedTvIds: state.pinnedTvIds,
        searchQuery: state.searchQuery,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<GlobalTVBasketState> | undefined;
        return {
          ...current,
          pinnedTvIds: dedupeTrafficVolumeIds(saved?.pinnedTvIds ?? []),
          searchQuery: typeof saved?.searchQuery === "string" ? saved.searchQuery : "",
        };
      },
    },
  ),
);
