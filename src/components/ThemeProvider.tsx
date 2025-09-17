"use client";

import { ReactNode, useEffect } from "react";
import { applyTheme } from "@/styles/theme";
import { useThemeStore } from "./useThemeStore";

interface ThemeProviderProps {
  children: ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyTheme(useThemeStore.getState().theme);
  }, []);

  return <>{children}</>;
}
