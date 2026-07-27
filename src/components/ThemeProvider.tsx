"use client";

import { ReactNode, useEffect } from "react";
import {
  applyTheme,
  resolveThemePreference,
  THEME_COOKIE_KEY,
  type ThemeName,
  type ThemePreference,
} from "@/styles/theme";
import { useThemeStore } from "./useThemeStore";

interface ThemeProviderProps {
  children: ReactNode;
}

const persistResolvedTheme = (nextTheme: ThemeName) => {
  applyTheme(nextTheme);
  if (typeof document === "undefined") return;
  document.cookie = `${THEME_COOKIE_KEY}=${encodeURIComponent(nextTheme)}; path=/; max-age=31536000; SameSite=Lax`;
};

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const preference = useThemeStore((state) => state.preference);
  const setResolvedTheme = useThemeStore((state) => state.setResolvedTheme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const resolved = resolveThemePreference(preference as ThemePreference, media.matches);
      setResolvedTheme(resolved);
      persistResolvedTheme(resolved);
    };
    sync();
    if (preference !== "system") return;
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [preference, setResolvedTheme]);

  return <>{children}</>;
}
