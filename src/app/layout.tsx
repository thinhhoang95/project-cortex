import type { Metadata } from 'next'
import Script from 'next/script'
import '../styles/globals.css'
import ThemeProvider from '@/components/ThemeProvider'
import { DEFAULT_THEME, THEMES, THEME_STORAGE_KEY } from '@/styles/theme'

const themeInitScript = `(() => {\n  const themes = ${JSON.stringify(THEMES)};\n  const storageKey = '${THEME_STORAGE_KEY}';\n  const fallback = '${DEFAULT_THEME}';\n  try {\n    const stored = window.localStorage.getItem(storageKey);\n    const parsed = stored ? JSON.parse(stored) : null;\n    const theme = parsed?.state?.theme;\n    const resolved = theme && themes[theme] ? theme : fallback;\n    const root = document.documentElement;\n    root.dataset.theme = resolved;\n    const vars = themes[resolved];\n    Object.keys(vars).forEach((key) => {\n      root.style.setProperty(key, vars[key]);\n    });\n  } catch (error) {\n    const root = document.documentElement;\n    root.dataset.theme = fallback;\n    const vars = themes[fallback];\n    Object.keys(vars).forEach((key) => {\n      root.style.setProperty(key, vars[key]);\n    });\n  }\n})();`;

export const metadata: Metadata = {
  title: 'Flow\'s Kitchen',
  description: 'Real-time flight trajectory visualization',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Script id="init-theme" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}