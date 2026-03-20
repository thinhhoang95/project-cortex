export type ThemeName = "light" | "dark";

export const THEME_STORAGE_KEY = "theme-preference";
export const THEME_COOKIE_KEY = "theme-preference";

type ThemeVariables = Record<string, string>;

export const THEMES: Record<ThemeName, ThemeVariables> = {
  light: {
    "--background": "#0f172a",
    "--foreground": "#f8fafc",
    "--panel-bg": "rgba(255, 255, 255, 0.18)",
    "--panel-bg-strong": "rgba(255, 255, 255, 0.28)",
    "--panel-bg-muted": "rgba(255, 255, 255, 0.08)",
    "--panel-border": "rgba(255, 255, 255, 0.22)",
    "--panel-divider": "rgba(255, 255, 255, 0.18)",
    "--panel-text-primary": "#f8fafc",
    "--panel-text-muted": "rgba(226, 232, 240, 0.72)",
    "--panel-shadow": "0 22px 45px -24px rgba(15, 23, 42, 0.55)",
    "--menu-bg": "rgba(255, 255, 255, 0.85)",
    "--menu-hover-bg": "rgba(255, 255, 255, 0.95)",
    "--menu-border": "rgba(148, 163, 184, 0.4)",
    "--menu-text": "#1e293b",
    "--menu-text-muted": "rgba(71, 85, 105, 0.75)",
    "--input-bg": "rgba(255, 255, 255, 0.12)",
    "--input-border": "rgba(255, 255, 255, 0.25)",
    "--input-placeholder": "rgba(248, 250, 252, 0.65)",
    "--analytics-background": "linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(15,23,42,0.65) 100%)",
    "--modal-overlay": "rgba(15, 23, 42, 0.65)",
    "--modal-surface": "rgba(28, 41, 64, 0.97)",
    "--modal-footer-bg": "rgba(22, 34, 54, 0.90)",
  },
  dark: {
    "--background": "#020617",
    "--foreground": "#e2e8f0",
    "--panel-bg": "rgba(2, 6, 23, 0.82)",
    "--panel-bg-strong": "rgba(15, 23, 42, 0.86)",
    "--panel-bg-muted": "rgba(15, 23, 42, 0.7)",
    "--panel-border": "rgba(94, 106, 134, 0.45)",
    "--panel-divider": "rgba(71, 85, 105, 0.45)",
    "--panel-text-primary": "#e2e8f0",
    "--panel-text-muted": "rgba(148, 163, 184, 0.8)",
    "--panel-shadow": "0 22px 55px -28px rgba(2, 6, 23, 0.7)",
    "--menu-bg": "rgba(15, 23, 42, 0.92)",
    "--menu-hover-bg": "rgba(30, 41, 59, 0.95)",
    "--menu-border": "rgba(71, 85, 105, 0.55)",
    "--menu-text": "#e2e8f0",
    "--menu-text-muted": "rgba(148, 163, 184, 0.75)",
    "--input-bg": "rgba(15, 23, 42, 0.65)",
    "--input-border": "rgba(71, 85, 105, 0.6)",
    "--input-placeholder": "rgba(148, 163, 184, 0.55)",
    "--analytics-background": "linear-gradient(180deg, rgba(2,6,23,0.96) 0%, rgba(2,6,23,0.72) 100%)",
    "--modal-overlay": "rgba(2, 6, 23, 0.82)",
    "--modal-surface": "rgba(5, 10, 28, 0.97)",
    "--modal-footer-bg": "rgba(3, 7, 20, 0.92)",
  },
};

export const DEFAULT_THEME: ThemeName = "light";

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && value in THEMES;
}

export function applyTheme(theme: ThemeName) {
  if (typeof document === "undefined") return;
  const palette = THEMES[theme] ?? THEMES[DEFAULT_THEME];
  const root = document.documentElement;
  root.dataset.theme = theme;
  for (const [variable, value] of Object.entries(palette)) {
    root.style.setProperty(variable, value);
  }
}
