import type { CSSProperties } from 'react'
import type { Metadata } from 'next'
import Script from 'next/script'
import { cookies } from 'next/headers'
import '../styles/globals.css'
import ThemeProvider from '@/components/ThemeProvider'
import {
  DEFAULT_THEME,
  THEMES,
  THEME_COOKIE_KEY,
  THEME_STORAGE_KEY,
  isThemeName,
  type ThemeName,
} from '@/styles/theme'

const themeInitScript = `(() => {\n  const themes = ${JSON.stringify(THEMES)};\n  const storageKey = '${THEME_STORAGE_KEY}';\n  const cookieKey = '${THEME_COOKIE_KEY}';\n  const fallback = '${DEFAULT_THEME}';\n  const applyTheme = (themeName) => {\n    const name = themes[themeName] ? themeName : fallback;\n    const vars = themes[name];\n    const root = document.documentElement;\n    root.dataset.theme = name;\n    Object.keys(vars).forEach((key) => {\n      root.style.setProperty(key, vars[key]);\n    });\n    const encoded = encodeURIComponent(name);\n    document.cookie = cookieKey + '=' + encoded + '; path=/; max-age=31536000; SameSite=Lax';\n  };\n  const readCookie = (key) => {\n    if (!document.cookie) return null;\n    const parts = document.cookie.split('; ');\n    for (let i = 0; i < parts.length; i += 1) {\n      const [name, ...value] = parts[i].split('=');\n      if (name === key) {\n        return decodeURIComponent(value.join('='));\n      }\n    }\n    return null;\n  };\n  try {\n    const stored = window.localStorage.getItem(storageKey);\n    if (stored) {\n      const parsed = JSON.parse(stored);\n      const candidate = parsed?.state?.theme;\n      if (candidate && themes[candidate]) {\n        applyTheme(candidate);\n        return;\n      }\n    }\n  } catch {}\n  const cookieTheme = readCookie(cookieKey);\n  if (cookieTheme && themes[cookieTheme]) {\n    applyTheme(cookieTheme);\n    return;\n  }\n  applyTheme(fallback);\n})();`;

function resolveInitialTheme(): ThemeName {
  const themeCookie = cookies().get(THEME_COOKIE_KEY)?.value
  return ensureThemeName(themeCookie)
}

function ensureThemeName(value: unknown): ThemeName {
  return isThemeName(value) ? value : DEFAULT_THEME
}

export const metadata: Metadata = {
  title: 'Flow\'s Kitchen',
  description: 'Real-time flight trajectory visualization',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const initialTheme = resolveInitialTheme()
  const initialVars = THEMES[initialTheme]
  return (
    <html lang="en" suppressHydrationWarning data-theme={initialTheme} style={initialVars as CSSProperties}>
      <body>
        <Script id="init-theme" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
