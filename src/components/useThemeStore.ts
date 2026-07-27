"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_THEME,
  DEFAULT_THEME_PREFERENCE,
  type ThemeName,
  type ThemePreference,
  THEME_STORAGE_KEY,
  isThemePreference,
} from "@/styles/theme";

type ThemeState = {
  theme: ThemeName;
  preference: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  setResolvedTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
};

type ThemeStorageState = Pick<ThemeState, "preference">;

const themePreferences: ThemePreference[] = ["light", "dark", "system"];

export const useThemeStore = create(
  persist<ThemeState, [], [], ThemeStorageState>(
    (set, get) => ({
      theme: DEFAULT_THEME,
      preference: DEFAULT_THEME_PREFERENCE,
      setTheme: (theme) => {
        const next = isThemePreference(theme) ? theme : DEFAULT_THEME_PREFERENCE;
        set({
          preference: next,
          ...(next === "system" ? {} : { theme: next }),
        });
      },
      setResolvedTheme: (theme) => set({ theme }),
      toggleTheme: () => {
        const current = get().preference;
        const idx = themePreferences.indexOf(current);
        const next = themePreferences[(idx + 1) % themePreferences.length];
        set({
          preference: next,
          ...(next === "system" ? {} : { theme: next }),
        });
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      version: 2,
      partialize: (state) => ({ preference: state.preference }),
      migrate: (persisted) => {
        const previous = persisted as { preference?: unknown; theme?: unknown } | undefined;
        const preference = isThemePreference(previous?.preference)
          ? previous.preference
          : isThemePreference(previous?.theme)
            ? previous.theme
            : DEFAULT_THEME_PREFERENCE;
        return { preference };
      },
    }
  )
);
