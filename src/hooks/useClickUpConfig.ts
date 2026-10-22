import { useState, useEffect } from 'react'
import type { ClickUpConfig } from '../types'
import { CONFIG_KEY, ensureMigrated, normalizeConfig } from '../lib/boards'

function loadFromStorage(): ClickUpConfig | null {
  try {
    // The config from before boards also held the board's list
    ensureMigrated(localStorage)
  } catch { /* storage full: the old shape still reads as a connection */ }
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return normalizeConfig(JSON.parse(raw))
  } catch {
    // corrupted — ignore
  }
  return null
}

// The ClickUp connection (token + workspace). Which list a board uses lives
// on the board (useBoards).
export function useClickUpConfig() {
  const [config, setConfigState] = useState<ClickUpConfig | null>(loadFromStorage)

  useEffect(() => {
    try {
      if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
      else localStorage.removeItem(CONFIG_KEY)
    } catch { /* quota */ }
  }, [config])

  function setConfig(next: ClickUpConfig) {
    setConfigState(next)
  }

  function clearConfig() {
    setConfigState(null)
  }

  return { config, setConfig, clearConfig }
}
