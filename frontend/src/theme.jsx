import { useCallback, useEffect, useState } from 'react'

// Light/dark switch. index.html stamps data-theme before first paint; this
// keeps it, localStorage and the browser-chrome colour in sync afterwards.
export function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('jarvis.theme', theme) } catch { /* private mode */ }
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#ece7da' : '#0a0a0b')
  }, [theme])
  const toggle = useCallback(
    () => setTheme((t) => (t === 'light' ? 'dark' : 'light')), [])
  return [theme, toggle]
}

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.4" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7
             16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
  </svg>
)
const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.6 14.2A8.8 8.8 0 0 1 9.8 3.4a8.8 8.8 0 1 0 10.8 10.8Z" />
  </svg>
)

export function ThemeToggle({ theme, onToggle }) {
  const light = theme === 'light'
  return (
    <button className="nav-chip" onClick={onToggle}
            aria-label={light ? 'switch to dark theme' : 'switch to light theme'}
            title={light ? 'dark mode' : 'light mode'}>
      {light ? <MoonIcon /> : <SunIcon />}
    </button>
  )
}
