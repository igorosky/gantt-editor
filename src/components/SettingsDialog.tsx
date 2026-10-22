import { useMemo, useState } from 'react'
import {
  BACKLOG_AREAS, DEFAULT_SETTINGS, WEEKDAYS, cleanNames, normalizeSettings, weekOrder, workdayLabel,
  type BacklogArea, type Settings,
} from '../lib/settings'

interface Props {
  settings: Settings
  knownStatuses: string[] // status names seen on the board and in the portfolio
  onSave: (next: Settings) => void
  onClose: () => void
}

const AREA_LABEL: Record<BacklogArea, string> = {
  board: 'Board rows and gantt bars',
  warnings: 'Task warnings',
  health: 'Portfolio health, KPIs and risks',
  workload: 'Workload (portfolio and board strip)',
}

const pct = (share: number) => String(Math.round(share * 100))

// Edits a draft; nothing applies until Save
export function SettingsDialog({ settings, knownStatuses, onSave, onClose }: Props) {
  const [warnings, setWarnings] = useState(settings.warnings)
  const [keywords, setKeywords] = useState(settings.warnings.dodKeywords.join(', '))
  const [weekStart, setWeekStart] = useState(settings.calendar.weekStart)
  const [workdays, setWorkdays] = useState(settings.calendar.workdays)
  const [statuses, setStatuses] = useState(settings.backlog.statuses)
  const [include, setInclude] = useState(settings.backlog.include)
  const [newStatus, setNewStatus] = useState('')
  const [dueSoon, setDueSoon] = useState(String(settings.rules.dueSoonDays))
  const [red, setRed] = useState(pct(settings.rules.redOverdueShare))
  const [amber, setAmber] = useState(pct(settings.rules.amberUnscheduledShare))
  const [msAs, setMsAs] = useState(settings.milestones.as)
  const [msTag, setMsTag] = useState(settings.milestones.tag)

  const keywordList = cleanNames(keywords.split(','))
  const isBacklogName = (name: string) => statuses.some(s => s.toLowerCase() === name.toLowerCase())

  // Every status worth offering: the ones in use plus the ones already picked
  const candidates = useMemo(
    () => cleanNames([...statuses, ...knownStatuses]).sort((a, b) => a.localeCompare(b)),
    [statuses, knownStatuses],
  )

  function toggleStatus(name: string) {
    setStatuses(prev => (isBacklogName(name)
      ? prev.filter(s => s.toLowerCase() !== name.toLowerCase())
      : [...prev, name]))
  }

  function addStatus() {
    const name = newStatus.trim()
    if (name && !isBacklogName(name)) setStatuses(prev => [...prev, name])
    setNewStatus('')
  }

  function toggleWorkday(d: number) {
    setWorkdays(prev => {
      if (!prev.includes(d)) return [...prev, d].sort((a, b) => a - b)
      return prev.length > 1 ? prev.filter(x => x !== d) : prev // keep at least one
    })
  }

  function reset() {
    const d = DEFAULT_SETTINGS
    setWarnings(d.warnings)
    setKeywords(d.warnings.dodKeywords.join(', '))
    setWeekStart(d.calendar.weekStart)
    setWorkdays(d.calendar.workdays)
    setStatuses(d.backlog.statuses)
    setInclude(d.backlog.include)
    setDueSoon(String(d.rules.dueSoonDays))
    setRed(pct(d.rules.redOverdueShare))
    setAmber(pct(d.rules.amberUnscheduledShare))
    setMsAs(d.milestones.as)
    setMsTag(d.milestones.tag)
  }

  function save() {
    // Out-of-range or empty numbers fall back to their defaults
    onSave(normalizeSettings({
      warnings: { ...warnings, dodKeywords: keywordList },
      calendar: { weekStart, workdays },
      backlog: { statuses, include },
      rules: {
        dueSoonDays: dueSoon.trim() === '' ? undefined : Number(dueSoon),
        redOverdueShare: red.trim() === '' ? undefined : Number(red) / 100,
        amberUnscheduledShare: amber.trim() === '' ? undefined : Number(amber) / 100,
      },
      // A blank tag falls back to the default
      milestones: { as: msAs, tag: msTag },
    }))
  }

  const check = (key: 'emptyDescription' | 'missingDod' | 'missingPriority', label: string) => (
    <label className="settings__check">
      <input
        type="checkbox"
        checked={warnings[key]}
        onChange={e => setWarnings(w => ({ ...w, [key]: e.target.checked }))}
      />
      {label}
    </label>
  )

  return (
    <div className="clickup-modal-overlay" onClick={onClose}>
      <div
        className="clickup-modal settings"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        role="dialog"
        aria-label="Settings"
      >
        <h2 className="clickup-modal__title">Settings</h2>

        <section className="settings__section">
          <h3 className="settings__heading">Task warnings</h3>
          {check('emptyDescription', 'Missing description')}
          {check('missingDod', 'Missing Definition of Done in the description')}
          <div className="clickup-modal__row settings__indent">
            <label htmlFor="set-dod">DoD keywords (comma separated, any one counts)</label>
            <input
              id="set-dod"
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              placeholder="DoD, Definition of Done"
            />
            <div className="clickup-modal__hint">
              Matched as whole words, case-insensitive. Portfolio lists other than the board
              re-check with new keywords on their next Refresh.
            </div>
          </div>
          {check('missingPriority', 'Missing priority')}
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">Calendar</h3>
          <div className="clickup-modal__row">
            <label htmlFor="set-week">Week starts on</label>
            <select id="set-week" value={weekStart} onChange={e => setWeekStart(Number(e.target.value))}>
              {weekOrder(1).map(d => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
            </select>
          </div>
          <div className="clickup-modal__row">
            <label>Working days: {workdayLabel(workdays)}</label>
            <div className="settings__chips" role="group" aria-label="Working days">
              {weekOrder(weekStart).map(d => (
                <button
                  key={d}
                  type="button"
                  className={`settings__chip${workdays.includes(d) ? ' settings__chip--on' : ''}`}
                  aria-pressed={workdays.includes(d)}
                  onClick={() => toggleWorkday(d)}
                >
                  {WEEKDAYS[d]}
                </button>
              ))}
            </div>
            <div className="clickup-modal__hint">
              Used for spreading time estimates, capacity and weekend shading.
            </div>
          </div>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">Backlog</h3>
          <div className="clickup-modal__row">
            <label>Statuses that mark a backlog task</label>
            <div className="settings__chips" role="group" aria-label="Backlog statuses">
              {candidates.map(name => (
                <button
                  key={name}
                  type="button"
                  className={`settings__chip${isBacklogName(name) ? ' settings__chip--on' : ''}`}
                  aria-pressed={isBacklogName(name)}
                  onClick={() => toggleStatus(name)}
                >
                  {name}
                </button>
              ))}
              {candidates.length === 0 && <span className="clickup-modal__hint">No statuses yet.</span>}
            </div>
            <div className="clickup-modal__token-row settings__add">
              <input
                value={newStatus}
                onChange={e => setNewStatus(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addStatus() }}
                placeholder="Add a status name"
                aria-label="Add a backlog status"
              />
              <button type="button" onClick={addStatus} disabled={!newStatus.trim()}>Add</button>
            </div>
          </div>
          <div className="clickup-modal__row">
            <label>Include backlog tasks in</label>
            {BACKLOG_AREAS.map(area => (
              <label key={area} className="settings__check">
                <input
                  type="checkbox"
                  checked={include[area]}
                  onChange={e => setInclude(prev => ({ ...prev, [area]: e.target.checked }))}
                />
                {AREA_LABEL[area]}
              </label>
            ))}
            <div className="clickup-modal__hint">Pull and push always include every task.</div>
          </div>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">ClickUp milestones</h3>
          <label className="settings__check">
            <input type="radio" name="set-ms" checked={msAs === 'type'} onChange={() => setMsAs('type')} />
            Milestone task type (needs the Milestones ClickApp)
          </label>
          <label className="settings__check">
            <input type="radio" name="set-ms" checked={msAs === 'tag'} onChange={() => setMsAs('tag')} />
            Normal tasks with a tag (Free Forever plan)
          </label>
          <div className="clickup-modal__row settings__indent">
            <label htmlFor="set-ms-tag">Milestone tag</label>
            <input
              id="set-ms-tag"
              value={msTag}
              onChange={e => setMsTag(e.target.value)}
              placeholder="milestone"
              disabled={msAs !== 'tag'}
            />
            <div className="clickup-modal__hint">
              A ClickUp task with this tag is a milestone on the board; the tag itself is not
              shown. Takes effect on the next Pull / Push, for portfolio lists on their next Refresh.
            </div>
          </div>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">Portfolio rules</h3>
          <div className="settings__grid">
            <label htmlFor="set-due">Due soon window (days)</label>
            <input id="set-due" type="number" min={0} max={365} value={dueSoon}
              onChange={e => setDueSoon(e.target.value)} />
            <label htmlFor="set-red">Off track when overdue share reaches (%)</label>
            <input id="set-red" type="number" min={0} max={100} value={red}
              onChange={e => setRed(e.target.value)} />
            <label htmlFor="set-amber">At risk when unscheduled share reaches (%)</label>
            <input id="set-amber" type="number" min={0} max={100} value={amber}
              onChange={e => setAmber(e.target.value)} />
          </div>
        </section>

        <div className="clickup-modal__actions">
          <button type="button" className="settings__reset" onClick={reset}>Reset to defaults</button>
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="clickup-modal__save"
            onClick={save}
            disabled={keywordList.length === 0}
            title={keywordList.length === 0 ? 'Enter at least one DoD keyword' : undefined}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
