import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  applyTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  graphColorsFor,
  isLightTheme,
  loadStoredTheme,
  resolveColors,
  storeTheme,
  type VsCodeTheme,
} from './vscode'

interface ThemeApi {
  theme: VsCodeTheme
  /** Theme with default colours merged in (what the UI actually renders) */
  resolved: VsCodeTheme
  /** Lane colours for the commit graph, derived from the theme's terminal palette */
  graphColors: string[]
  isLight: boolean
  isCustom: boolean
  setTheme: (theme: VsCodeTheme | null) => void
}

const ThemeContext = createContext<ThemeApi | null>(null)

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [custom, setCustom] = useState<VsCodeTheme | null>(loadStoredTheme)
  const theme = custom ?? DEFAULT_DARK_THEME

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const api = useMemo<ThemeApi>(() => {
    const light = isLightTheme(theme)
    return {
      theme,
      resolved: {
        ...theme,
        type: theme.type ?? (light ? 'light' : 'dark'),
        colors: resolveColors(theme),
      },
      graphColors: graphColorsFor(theme),
      isLight: light,
      isCustom: custom !== null,
      setTheme: (t) => {
        storeTheme(t)
        setCustom(t)
      },
    }
  }, [theme, custom])

  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>
}

export const BUILT_IN_THEMES = [DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME]
