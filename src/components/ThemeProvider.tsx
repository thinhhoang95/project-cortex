"use client";

import { ReactNode, useEffect } from "react";
import { applyTheme, THEME_COOKIE_KEY, type ThemeName } from "@/styles/theme";
import { useThemeStore } from "./useThemeStore";

interface ThemeProviderProps {
  children: ReactNode;
}

const persistThemePreference = (nextTheme: ThemeName) => {
  applyTheme(nextTheme);
  if (typeof document === "undefined") return;
  document.cookie = `${THEME_COOKIE_KEY}=${encodeURIComponent(nextTheme)}; path=/; max-age=31536000; SameSite=Lax`;
};

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    persistThemePreference(theme);
  }, [theme]);

  useEffect(() => {
    persistThemePreference(useThemeStore.getState().theme);
  }, []);

  return <>{children}</>;
}
