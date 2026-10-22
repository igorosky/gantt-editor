// SECURITY: ClickUp token is held in localStorage — readable by any XSS in this origin.
// Acceptable for personal-tool use. To harden, move to HttpOnly cookie + backend.

import { useEffect, useState } from 'react'
import { ClickUpError, listTeams, type Team } from '../lib/clickup'
import type { ClickUpConfig } from '../types'

interface Props {
  open: boolean
  config: ClickUpConfig | null
  onSave: (next: ClickUpConfig) => void
  onDisconnect: () => void
  onClose: () => void
}

// The connection only: token + workspace. Boards pick their list in the board
// switcher, the portfolio its lists under Projects.
export function ClickUpSettings({ open, config, onSave, onDisconnect, onClose }: Props) {
  const [token, setToken] = useState('')
  const [teamId, setTeamId] = useState('')
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadTeams(tok: string) {
    if (!tok.trim()) {
      setError('Token is required')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const t = await listTeams(tok.trim())
      setTeams(t)
      setTeamId(prev => (t.some(x => x.id === prev) ? prev : t.length === 1 ? t[0].id : ''))
    } catch (e) {
      setTeams([])
      setError(e instanceof ClickUpError ? `Load workspaces: ${e.message} (${e.status})` : `Load workspaces: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  // A saved token loads its workspaces straight away
  useEffect(() => {
    if (!open) return
    setToken(config?.token ?? '')
    setTeamId(config?.teamId ?? '')
    setTeams([])
    setError(null)
    if (config?.token) void loadTeams(config.token)
  }, [open, config]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const canSave = !!(token.trim() && teamId && teams.some(t => t.id === teamId))

  return (
    <div className="clickup-modal-overlay" onClick={onClose}>
      <div className="clickup-modal" onClick={e => e.stopPropagation()}>
        <h2 className="clickup-modal__title">ClickUp connection</h2>

        <div className="clickup-modal__row">
          <label htmlFor="cu-token">Personal API Token</label>
          <div className="clickup-modal__token-row">
            <input
              id="cu-token"
              type="password"
              autoComplete="off"
              placeholder="pk_..."
              value={token}
              onChange={e => {
                setToken(e.target.value)
                setTeams([])
              }}
              onKeyDown={e => { if (e.key === 'Enter') void loadTeams(token) }}
            />
            <button type="button" onClick={() => void loadTeams(token)} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </button>
          </div>
          <div className="clickup-modal__hint">
            Generate at ClickUp → Settings → Apps → API Token. Stored in browser localStorage.
          </div>
        </div>

        <div className="clickup-modal__row">
          <label htmlFor="cu-team">Workspace</label>
          <select
            id="cu-team"
            value={teamId}
            onChange={e => setTeamId(e.target.value)}
            disabled={teams.length === 0}
          >
            <option value="">{teams.length ? '— select —' : '(load workspaces first)'}</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="clickup-modal__hint">
            Open a ClickUp list as a board from the board switcher next to Board / Portfolio.
            The portfolio picks its lists under Portfolio → Projects.
          </div>
        </div>

        {error && <div className="clickup-modal__error">{error}</div>}

        <div className="clickup-modal__actions">
          {config && (
            <button
              type="button"
              className="clickup-modal__disconnect"
              title="Forget the token. Boards and their tasks stay in this browser."
              onClick={onDisconnect}
            >
              Disconnect
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canSave && onSave({ token: token.trim(), teamId })}
            disabled={!canSave}
            className="clickup-modal__save"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
