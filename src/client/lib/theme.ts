export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'bb-theme'

export function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* localStorage may be unavailable (private mode, etc.) — fall through */
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'dark'
}

export function setTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', mode)
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* best-effort persist */
  }
}

export function toggleTheme(): ThemeMode {
  const current = (document.documentElement.getAttribute('data-theme') as ThemeMode) ?? 'light'
  const next: ThemeMode = current === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

export function getTheme(): ThemeMode {
  if (typeof document === 'undefined') return 'light'
  return (document.documentElement.getAttribute('data-theme') as ThemeMode) ?? 'light'
}
