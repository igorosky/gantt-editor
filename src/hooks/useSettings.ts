import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../lib/settings'

const STORAGE_KEY = 'gantt-settings'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeSettings(JSON.parse(raw))
  } catch { /* malformed entry */ }
  return DEFAULT_SETTINGS
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch { /* quota */ }
  }, [settings])

  return { settings, setSettings }
}
