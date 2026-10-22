import { useEffect, useMemo, useState } from 'react'
import type { ClickUpConfig } from '../../types'
import type { PortfolioState } from '../../hooks/usePortfolio'
import type { WorkspaceTree } from '../../hooks/useWorkspaceTree'
import type { ProjectRef } from '../../lib/portfolioData'
import type { PortfolioTab } from '../../hooks/useHashRoute'
import { OverviewTab } from './OverviewTab'
import { RoadmapTab } from './RoadmapTab'
import { GanttTab } from './GanttTab'
import { WorkloadTab } from './WorkloadTab'
import { PeopleTab } from './PeopleTab'
import { ProjectPicker } from './ProjectPicker'
import type { Settings } from '../../lib/settings'
import { timeAgo } from '../../lib/dates'
import './Portfolio.css'

interface Props {
  pf: PortfolioState
  tab: PortfolioTab
  onTab: (tab: PortfolioTab) => void
  // Shows a project as the board; no ref = the current board
  onOpenBoard: (ref?: ProjectRef) => void
  onOpenSettings: () => void
  cu: ClickUpConfig | null
  workspace: WorkspaceTree
  settings: Settings
}

const TABS: Array<[PortfolioTab, string]> = [
  ['overview', 'Overview'],
  ['roadmap', 'Roadmap'],
  ['gantt', 'Gantt'],
  ['workload', 'Workload'],
  ['people', 'People'],
]

export function PortfolioView({ pf, tab, onTab, onOpenBoard, onOpenSettings, cu, workspace, settings }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  // Fixed for the session so every chart agrees on what "today" is
  const [today] = useState(() => new Date())

  // Fetch lists that were picked but have nothing cached yet
  const { missing, canFetch, progress, refresh } = pf
  useEffect(() => {
    if (canFetch && !progress && missing.length) refresh(missing.map(r => r.listId))
  }, [missing, canFetch, progress, refresh])

  const fetched = pf.projects.filter(p => !p.isCurrentBoard).map(p => p.fetchedAt).filter(Boolean) as string[]
  const oldest = fetched.sort()[0]
  const errors = pf.projects.filter(p => p.error)
  const teamId = pf.isDemo ? undefined : cu?.teamId
  const visible = pf.visible
  const now = useMemo(() => Date.now(), [pf.projects]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pf">
      <div className="pf-toolbar">
        <nav className="pf-tabs" aria-label="Portfolio views">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" className={`pf-tab${tab === id ? ' is-on' : ''}`}
              aria-current={tab === id ? 'page' : undefined} onClick={() => onTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="pf-spacer" />
        {pf.isDemo ? (
          <span className="pf-demo">
            Demo data
            <button type="button" className="pf-btn pf-btn--sm" onClick={pf.exitDemo}>Exit demo</button>
          </span>
        ) : (
          <>
            {canFetch && (
              <span className="pf-stamp" title={oldest ? `Oldest data fetched ${new Date(oldest).toLocaleString()}` : undefined}>
                {progress ? `Fetching ${progress.done}/${progress.total}…` : fetched.length ? `Fetched ${timeAgo(oldest, now)}` : ''}
              </span>
            )}
            <button type="button" className="pf-btn" disabled={!canFetch || !!progress || pf.refs.length === 0}
              onClick={() => refresh()} title="Fetch the selected lists from ClickUp again (read only)">
              ↻ Refresh
            </button>
            <button type="button" className="pf-btn pf-btn--primary" onClick={() => setPickerOpen(true)}
              disabled={!canFetch || !cu?.teamId} title={canFetch ? 'Choose which ClickUp lists to include' : 'Connect ClickUp first'}>
              Projects ({pf.refs.length || pf.projects.length})
            </button>
          </>
        )}
      </div>

      <div className="pf-chips" aria-label="Show or hide projects">
        {pf.projects.map(p => {
          const off = pf.hidden.has(p.ref.listId)
          return (
            <button key={p.ref.listId} type="button" className={`pf-chip${off ? ' is-off' : ''}`}
              aria-pressed={!off} onClick={() => pf.toggleHidden(p.ref.listId)}
              title={off ? 'Show this project' : 'Hide this project'}>
              <span className="pf-dot" style={{ background: p.color }} />
              {p.ref.name}
              {p.isCurrentBoard && <span className="pf-chip__tag">board</span>}
              {p.error && <span className="pf-warn-icon" title={p.error}>⚠</span>}
            </button>
          )
        })}
      </div>

      {!canFetch && !pf.isDemo && (
        <div className="pf-banner">
          Only the current board is shown. Connect ClickUp to pick more projects, or try the views with sample data.
          <span className="pf-banner__actions">
            <button type="button" className="pf-btn pf-btn--sm" onClick={onOpenSettings}>Connect ClickUp</button>
            <button type="button" className="pf-btn pf-btn--sm" onClick={pf.loadDemo}>Load demo data</button>
          </span>
        </div>
      )}
      {canFetch && !pf.isDemo && pf.refs.length === 0 && (
        <div className="pf-banner">
          Showing the current board only. Pick the ClickUp lists that make up your portfolio.
          <span className="pf-banner__actions">
            <button type="button" className="pf-btn pf-btn--sm pf-btn--primary" onClick={() => setPickerOpen(true)}>Choose projects</button>
            <button type="button" className="pf-btn pf-btn--sm" onClick={pf.loadDemo}>Load demo data</button>
          </span>
        </div>
      )}
      {pf.notice && <div className="pf-banner pf-banner--warn">{pf.notice}</div>}
      {errors.length > 0 && !progress && (
        <div className="pf-banner pf-banner--warn">
          {errors.map(p => <div key={p.ref.listId}>⚠ {p.ref.name}: {p.error}{p.fetchedAt ? ' (showing older data)' : ''}</div>)}
        </div>
      )}

      <div className="pf-body">
        {tab === 'overview' && (
          <OverviewTab projects={visible} today={today} teamId={teamId} onOpenBoard={onOpenBoard} settings={settings} />
        )}
        {tab === 'roadmap' && <RoadmapTab projects={visible} today={today} settings={settings} />}
        {tab === 'gantt' && <GanttTab projects={visible} today={today} settings={settings} />}
        {tab === 'workload' && <WorkloadTab projects={visible} today={today} settings={settings} />}
        {tab === 'people' && <PeopleTab projects={visible} today={today} settings={settings} />}
      </div>

      {pickerOpen && cu?.token && cu.teamId && (
        <ProjectPicker
          workspace={workspace}
          boardListId={pf.boardListId}
          refs={pf.refs}
          onSave={refs => { pf.setRefs(refs); setPickerOpen(false) }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
