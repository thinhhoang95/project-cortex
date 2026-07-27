"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_HOTSPOT_COLORING_SETTINGS,
  normalizeHotspotColoringSettings,
  type HotspotColoringSettings,
} from "@/lib/hotspotColoring";

type HotspotSettingsState = {
  settings: HotspotColoringSettings;
  setSettings: (settings: HotspotColoringSettings) => void;
  resetSettings: () => void;
};

export const useHotspotSettingsStore = create(
  persist<HotspotSettingsState, [], [], Pick<HotspotSettingsState, "settings">>(
    (set) => ({
      settings: DEFAULT_HOTSPOT_COLORING_SETTINGS,
      setSettings: (settings) => set({ settings: normalizeHotspotColoringSettings(settings) }),
      resetSettings: () => set({
        settings: {
          global: { ...DEFAULT_HOTSPOT_COLORING_SETTINGS.global },
          overrides: [],
        },
      }),
    }),
    {
      name: "cortex-hotspot-coloring",
      version: 1,
      partialize: (state) => ({ settings: state.settings }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<HotspotSettingsState> | undefined;
        return {
          ...current,
          settings: normalizeHotspotColoringSettings(saved?.settings),
        };
      },
    },
  ),
);
