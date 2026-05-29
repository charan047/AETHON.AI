import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

export type ThemeMode = 'dark' | 'light'

const THEME_STORAGE_KEY = 'aethon-theme'

function preferredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function initializeTheme() {
  if (typeof document === 'undefined') return 'dark' as ThemeMode
  const theme = preferredTheme()
  document.documentElement.setAttribute('data-theme', theme)
  return theme
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => preferredTheme())

  useEffect(() => {
    const nextTheme = initializeTheme()
    setTheme(nextTheme)
  }, [])

  const toggleTheme = () => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="btn-icon relative overflow-hidden"
    >
      <span
        className="absolute inset-0 transition-transform duration-200"
        style={{ transform: theme === 'dark' ? 'rotate(0deg)' : 'rotate(180deg)' }}
      />
      {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  )
}
