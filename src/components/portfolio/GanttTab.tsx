import { useEffect, useMemo, useRef, useState } from 'react'
import {
  HEADER_H, autoUnit, buildGanttSvg, lhsWidth, rowHeight, rowsWindow, type LhsColumn,
} from '../../lib/exportGantt'
import { portfolioCritical, portfolioGanttRows, type GanttOrder } from '../../lib/portfolioGantt'
import type { PortfolioProject } from '../../lib/portfolioData'
import type { Settings } from '../../lib/settings'
import { ExportDialog, type ExportSource, type UnitChoice } from '../ExportDialog'
import { Seg } from './shared'

interface Props {
  projects: PortfolioProject[]
  today: Date
  settings: Settings
}

const STORAGE_KEY = 'portfolio-gantt'
const COLUMNS: LhsColumn[] = ['name', 'start', 'end']
const CHART_ID = 'pf-gantt-chart'
const FONT = 'Helvetica, Arial, sans-serif'

interface GanttPrefs {
  unit: UnitChoice
  subtasks: boolean
  includeDone: boolean
  includeDateless: boolean
  order: GanttOrder
  critical: boolean
  collapsed: string[] // project ids
}

const DEFAULTS: GanttPrefs = {
  unit: 'auto',
  subtasks: true,
  includeDone: true,
  includeDateless: false,
  order: 'start',
  critical: false,
  collapsed: [],
}

const UNITS: UnitChoice[] = ['auto', 'day', 'week', 'month']

function loadPrefs(): GanttPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<Record<keyof GanttPrefs, unknown>>
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
    return {
      unit: UNITS.includes(p.unit as UnitChoice) ? (p.unit as UnitChoice) : DEFAULTS.unit,
      subtasks: bool(p.subtasks, DEFAULTS.subtasks),
      includeDone: bool(p.includeDone, DEFAULTS.includeDone),
      includeDateless: bool(p.includeDateless, DEFAULTS.includeDateless),
      order: p.order === 'list' ? 'list' : 'start',
      critical: bool(p.critical, DEFAULTS.critical),
      collapsed: Array.isArray(p.collapsed) ? p.collapsed.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return DEFAULTS
  }
}

// An inline <svg> showing one region of the chart through <use>, for the
// pinned names column and date header
function viewOf(x: number, y: number, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" ` +
    `font-family="${FONT}"><use href="#${CHART_ID}"/></svg>`
}

// Read-only gantt over the visible projects, one section per project. Drawn by
// the export renderer, so the Export button prints exactly this chart.
export function GanttTab({ projects, today, settings }: Props) {
  const [prefs, setPrefs] = useState<GanttPrefs>(loadPrefs)
  const [exportOpen, setExportOpen] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)) } catch { /* quota */ }
  }, [prefs])

  const set = <K extends keyof GanttPrefs>(key: K, value: GanttPrefs[K]) =>
    setPrefs(prev => ({ ...prev, [key]: value }))

  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed])
  const { rows, depths } = useMemo(
    () => portfolioGanttRows(projects, today, settings, {
      subtasks: prefs.subtasks,
      includeDone: prefs.includeDone,
      includeDateless: prefs.includeDateless,
      order: prefs.order,
      collapsed,
    }),
    [projects, today, settings, prefs.subtasks, prefs.includeDone, prefs.includeDateless, prefs.order, collapsed],
  )
  const critical = useMemo(() => portfolioCritical(projects, settings), [projects, settings])

  const { from, to } = useMemo(
    () => rowsWindow(rows, prefs.unit, settings.calendar.weekStart),
    [rows, prefs.unit, settings.calendar.weekStart],
  )
  const unit = prefs.unit === 'auto' ? autoUnit(from, to) : prefs.unit

  const built = useMemo(
    () => (rows.length
      ? buildGanttSvg(rows, {
          columns: COLUMNS, from, to, unit,
          showToday: true, showArrows: true,
          criticalIds: prefs.critical ? critical.taskIds : undefined,
          criticalEdges: prefs.critical ? critical.edges : undefined,
          depths, calendar: settings.calendar, today, sectionToggles: true,
        })
      : null),
    [rows, from, to, unit, prefs.critical, critical, depths, settings.calendar, today],
  )

  const lhsW = lhsWidth(COLUMNS)
  const markup = useMemo(() => {
    if (!built) return null
    const { width: w, height: h } = built
    return {
      chart: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
        `font-family="${FONT}"><g id="${CHART_ID}">${built.body}</g></svg>`,
      top: viewOf(0, 0, w, HEADER_H),
      left: viewOf(0, 0, lhsW, h),
      corner: viewOf(0, 0, lhsW, HEADER_H),
    }
  }, [built, lhsW])

  // Row tops in chart coordinates, for mapping a click to its row
  const tops = useMemo(() => {
    let y = HEADER_H
    return rows.map(r => { const top = y; y += rowHeight(r); return top })
  }, [rows])

  function toggle(id: string) {
    setPrefs(prev => ({
      ...prev,
      collapsed: prev.collapsed.includes(id) ? prev.collapsed.filter(x => x !== id) : [...prev.collapsed, id],
    }))
  }

  // Clicks on the pinned names column land on a <use> copy, so the row is
  // found from the pointer position rather than from the event target
  function onChartClick(e: React.MouseEvent) {
    if ((e.target as Element).closest('.pf-gantt-pin--top, .pf-gantt-pin--corner')) return
    const canvas = canvasRef.current
    if (!canvas) return
    const y = e.clientY - canvas.getBoundingClientRect().top
    for (let i = rows.length - 1; i >= 0; i--) {
      if (tops[i] > y) continue
      const row = rows[i]
      if (row.kind === 'section' && y < tops[i] + rowHeight(row)) toggle(row.section.id)
      return
    }
  }

  const allCollapsed = projects.length > 0 && projects.every(p => collapsed.has(p.ref.listId))

  const source = useMemo<ExportSource>(() => ({
    kind: 'sections', rows, depths, critical,
    unit: prefs.unit, criticalOn: prefs.critical, today,
  }), [rows, depths, critical, prefs.unit, prefs.critical, today])

  return (
    <div className="pf-gantt">
      <div className="pf-controls">
        <Seg label="Zoom" value={prefs.unit} onChange={v => set('unit', v)}
          options={[['auto', `Auto (${unit})`], ['day', 'Days'], ['week', 'Weeks'], ['month', 'Months']]} />
        <Seg label="Order" value={prefs.order} onChange={v => set('order', v)}
          options={[['start', 'By start date'], ['list', 'List order']]} />
        <label className="pf-check">
          <input type="checkbox" checked={prefs.subtasks} onChange={e => set('subtasks', e.target.checked)} />
          Subtasks
        </label>
        <label className="pf-check">
          <input type="checkbox" checked={prefs.includeDone} onChange={e => set('includeDone', e.target.checked)} />
          Done tasks
        </label>
        <label className="pf-check">
          <input type="checkbox" checked={prefs.includeDateless} onChange={e => set('includeDateless', e.target.checked)} />
          Tasks without dates
        </label>
        <label className="pf-check" title="Each project's own longest chain of dependent tasks">
          <input type="checkbox" checked={prefs.critical} onChange={e => set('critical', e.target.checked)} />
          Critical path
        </label>
        <button type="button" className="pf-btn" disabled={projects.length === 0}
          onClick={() => set('collapsed', allCollapsed ? [] : projects.map(p => p.ref.listId))}>
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
        <button type="button" className="pf-btn pf-btn--primary" disabled={!built}
          onClick={() => setExportOpen(true)} title="Export this chart to PDF or PNG">
          Export
        </button>
        <span className="pf-muted pf-gantt__hint">
          One section per project; its bar runs from first start to last due date, dark part = share done. Click a project row to fold it.
        </span>
      </div>

      <div className="pf-card pf-gantt-card">
        {markup && built ? (
          <div className="pf-gantt-scroll">
            <div ref={canvasRef} className="pf-gantt-canvas" style={{ width: built.width, height: built.height }}
              onClick={onChartClick}>
              <div className="pf-gantt-pin pf-gantt-pin--top" dangerouslySetInnerHTML={{ __html: markup.top }} />
              <div className="pf-gantt-pin pf-gantt-pin--left" style={{ width: lhsW }}
                dangerouslySetInnerHTML={{ __html: markup.left }} />
              <div className="pf-gantt-pin pf-gantt-pin--corner" style={{ width: lhsW }}
                dangerouslySetInnerHTML={{ __html: markup.corner }} />
              <div dangerouslySetInnerHTML={{ __html: markup.chart }} />
            </div>
          </div>
        ) : (
          <p className="pf-empty">No projects selected.</p>
        )}
      </div>

      {exportOpen && (
        <ExportDialog source={source} calendar={settings.calendar} onClose={() => setExportOpen(false)} />
      )}
    </div>
  )
}
