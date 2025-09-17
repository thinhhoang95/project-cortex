"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_THEME, ThemeName, THEMES, THEME_STORAGE_KEY } from "@/styles/theme";

type ThemeState = {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
};

type ThemeStorageState = Pick<ThemeState, "theme">;

const themeNames = Object.keys(THEMES) as ThemeName[];

export const useThemeStore = create(
  persist<ThemeState, [], [], ThemeStorageState>(
    (set, get) => ({
      theme: DEFAULT_THEME,
      setTheme: (theme) => {
        const next = themeNames.includes(theme) ? theme : DEFAULT_THEME;
        set({ theme: next });
      },
      toggleTheme: () => {
        const current = get().theme;
        const idx = themeNames.indexOf(current);
        const next = idx === -1 ? DEFAULT_THEME : themeNames[(idx + 1) % themeNames.length];
        set({ theme: next });
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({ theme: state.theme }),
    }
  )
);
