import { useEffect, useMemo, useState } from 'react'
import type { GanttTask } from '../types'
import { isMilestone } from '../utils'
import { DatePicker } from './DatePicker'
import {
  COLUMNS, COLUMN_ORDER, autoUnit, buildGanttSvg, fitWindow, lhsWidth, svgDocument,
} from '../lib/exportGantt'
import type { ExportOptions, LhsColumn, TimeUnit } from '../lib/exportGantt'
import {
  PAPER_LABELS, buildPages, downloadPng, effectiveScale, pageCount, paperGeom, printPages,
} from '../lib/exportOutput'
import type { PaperName } from '../lib/exportOutput'
import { EMPTY_CRITICAL, computeCriticalPath } from '../lib/criticalPath'
import { buildTree, flattenTree, selectionDepths } from '../lib/tree'

interface Props {
  tasks: GanttTask[]      // currently visible (filters applied)
  allTasks: GanttTask[]
  onClose: () => void
}

type Format = 'png' | 'pdf'
type Scope = 'visible' | 'all' | 'pick'
type CritScope = 'project' | 'export'
type UnitChoice = TimeUnit | 'auto'

const STORAGE_KEY = 'gantt-export-opts'

interface StoredOpts {
  format: Format
  scope: Scope
  includeDateless: boolean
  columns: LhsColumn[]
  unit: UnitChoice
  showArrows: boolean
  showToday: boolean
  highlightCritical: boolean
  critScope: CritScope
  paper: PaperName
  landscape: boolean
  multipage: boolean
  pngScale: number
}

const DEFAULTS: StoredOpts = {
  format: 'pdf',
  scope: 'visible',
  includeDateless: true,
  columns: ['name', 'start', 'end'],
  unit: 'auto',
  showArrows: true,
  showToday: true,
  highlightCritical: false,
  critScope: 'project',
  paper: 'a4',
  landscape: true,
  multipage: false,
  pngScale: 2,
}

function loadStored(): StoredOpts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<StoredOpts>
    const cols = (parsed.columns ?? DEFAULTS.columns).filter(c => c in COLUMNS)
    return { ...DEFAULTS, ...parsed, columns: cols.length ? cols : DEFAULTS.columns }
  } catch {
    return DEFAULTS
  }
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ExportDialog({ tasks, allTasks, onClose }: Props) {
  const stored = useMemo(loadStored, [])

  const [format, setFormat] = useState<Format>(stored.format)
  const [scope, setScope] = useState<Scope>(stored.scope)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(tasks.map(t => t.id)))
  const [includeDateless, setIncludeDateless] = useState(stored.includeDateless)
  const [rangeMode, setRangeMode] = useState<'fit' | 'custom'>('fit')
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined)
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined)
  const [unitChoice, setUnitChoice] = useState<UnitChoice>(stored.unit)
  const [columnSet, setColumnSet] = useState<Set<LhsColumn>>(() => new Set(stored.columns))
  const [title, setTitle] = useState('')
  const [showArrows, setShowArrows] = useState(stored.showArrows)
  const [showToday, setShowToday] = useState(stored.showToday)
  const [highlightCritical, setHighlightCritical] = useState(stored.highlightCritical)
  const [critScope, setCritScope] = useState<CritScope>(stored.critScope)
  const [paper, setPaper] = useState<PaperName>(stored.paper)
  const [landscape, setLandscape] = useState(stored.landscape)
  const [multipage, setMultipage] = useState(stored.multipage)
  const [pngScale, setPngScale] = useState(stored.pngScale)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === 'Escape' && tag !== 'INPUT' && tag !== 'TEXTAREA') onClose()
    }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  useEffect(() => {
    const toStore: StoredOpts = {
      format, scope, includeDateless,
      columns: COLUMN_ORDER.filter(c => columnSet.has(c)),
      unit: unitChoice, showArrows, showToday, highlightCritical, critScope,
      paper, landscape, multipage, pngScale,
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore)) } catch { /* quota */ }
  }, [format, scope, includeDateless, columnSet, unitChoice, showArrows, showToday,
      highlightCritical, critScope, paper, landscape, multipage, pngScale])

  /* ------------------------------------------------------------ derived */

  // Every task in board order (subtasks under their parent), all expanded.
  // `tasks` already arrives in that order, minus collapsed subtasks.
  const treeRows = useMemo(() => flattenTree(allTasks), [allTasks])

  const selected = useMemo(() => {
    const base =
      scope === 'all' ? treeRows.map(r => r.task) :
      scope === 'visible' ? tasks :
      treeRows.map(r => r.task).filter(t => picked.has(t.id))
    return includeDateless ? base : base.filter(t => t.start || t.end)
  }, [scope, tasks, treeRows, picked, includeDateless])

  // Like the critical path, computed over the whole selection before paging
  const depths = useMemo(() => selectionDepths(selected, buildTree(allTasks)), [selected, allTasks])

  const columns = useMemo(
    () => COLUMN_ORDER.filter(c => c === 'name' || columnSet.has(c)),
    [columnSet],
  )

  const fitted = useMemo(() => fitWindow(selected, unitChoice), [selected, unitChoice])
  const from = rangeMode === 'custom' ? (customFrom ?? fitted.from) : fitted.from
  const to = rangeMode === 'custom' ? (customTo ?? fitted.to) : fitted.to
  const rangeValid = from <= to
  const unit: TimeUnit = unitChoice === 'auto' ? autoUnit(from, to) : unitChoice

  // Computed once over the whole set being exported, never per page: buildPages
  // hands each page a slice of the rows, which would otherwise yield a different
  // path on every page.
  const critical = useMemo(
    () => (highlightCritical
      ? computeCriticalPath(critScope === 'export' ? selected : allTasks)
      : EMPTY_CRITICAL),
    [highlightCritical, critScope, selected, allTasks],
  )

  const opts: ExportOptions = useMemo(() => ({
    columns, from, to, unit,
    title: title.trim() || undefined,
    showToday, showArrows,
    criticalIds: critical.taskIds,
    criticalEdges: critical.edges,
    depths,
  }), [columns, from, to, unit, title, showToday, showArrows, critical, depths])

  const built = useMemo(
    () => (selected.length && rangeValid ? buildGanttSvg(selected, opts) : null),
    [selected, opts, rangeValid],
  )

  const geom = useMemo(() => paperGeom(paper, landscape), [paper, landscape])
  const pages = useMemo(
    () => (built ? pageCount(selected, opts, geom, multipage) : 0),
    [built, selected, opts, geom, multipage],
  )

  const realScale = built ? effectiveScale(built.width, built.height, pngScale) : pngScale
  const pngW = built ? Math.round(built.width * realScale) : 0
  const pngH = built ? Math.round(built.height * realScale) : 0

  /* ------------------------------------------------------------- actions */

  function toggleColumn(c: LhsColumn) {
    if (c === 'name') return
    setColumnSet(prev => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  function togglePick(id: string) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runExport() {
    if (!built) return
    setBusy(true)
    setError(null)
    try {
      if (format === 'png') {
        await downloadPng(built, pngScale, `gantt-${todayStamp()}.png`)
      } else {
        printPages(buildPages(selected, opts, geom, multipage), geom,
          title.trim() || `Gantt ${todayStamp()}`)
      }
      onClose()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const pickList = scope === 'pick' ? treeRows : []

  return (
    <div className="tdp-overlay" onClick={onClose}>
      <div className="exp-modal" onClick={e => e.stopPropagation()}>
        <div className="exp-head">
          <h3 className="exp-title">Export chart</h3>
          <div className="exp-seg">
            <button type="button" className={format === 'pdf' ? 'is-on' : ''} onClick={() => setFormat('pdf')}>PDF</button>
            <button type="button" className={format === 'png' ? 'is-on' : ''} onClick={() => setFormat('png')}>PNG</button>
          </div>
          <div className="exp-head-spacer" />
          <button className="exp-close" onClick={onClose} type="button" aria-label="Close">✕</button>
        </div>

        <div className="exp-body">
          <div className="exp-opts">

            {/* --------------------------------------------------- tasks */}
            <section className="exp-group">
              <div className="exp-group-title">Tasks</div>
              <label className="exp-radio">
                <input type="radio" checked={scope === 'visible'} onChange={() => setScope('visible')} />
                Currently visible <span className="exp-dim">({tasks.length})</span>
              </label>
              <label className="exp-radio">
                <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
                All tasks <span className="exp-dim">({allTasks.length})</span>
              </label>
              <label className="exp-radio">
                <input type="radio" checked={scope === 'pick'} onChange={() => setScope('pick')} />
                Pick manually <span className="exp-dim">({picked.size})</span>
              </label>
              {scope === 'pick' && (
                <div className="exp-pick">
                  <div className="exp-pick-actions">
                    <button type="button" onClick={() => setPicked(new Set(allTasks.map(t => t.id)))}>All</button>
                    <button type="button" onClick={() => setPicked(new Set())}>None</button>
                  </div>
                  <div className="exp-pick-list">
                    {pickList.map(({ task: t, depth }) => (
                      <label key={t.id} className="exp-check exp-pick-row" style={depth ? { paddingLeft: depth * 14 } : undefined}>
                        <input type="checkbox" checked={picked.has(t.id)} onChange={() => togglePick(t.id)} />
                        {isMilestone(t) && <span className="exp-ms">◆</span>}
                        <span className="exp-pick-name">{t.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label className="exp-check">
                <input type="checkbox" checked={includeDateless} onChange={e => setIncludeDateless(e.target.checked)} />
                Include tasks without dates
              </label>
            </section>

            {/* ---------------------------------------------- time period */}
            <section className="exp-group">
              <div className="exp-group-title">Time period</div>
              <label className="exp-radio">
                <input type="radio" checked={rangeMode === 'fit'} onChange={() => setRangeMode('fit')} />
                Fit to tasks
              </label>
              <label className="exp-radio">
                <input
                  type="radio"
                  checked={rangeMode === 'custom'}
                  onChange={() => {
                    setCustomFrom(prev => prev ?? fitted.from)
                    setCustomTo(prev => prev ?? fitted.to)
                    setRangeMode('custom')
                  }}
                />
                Custom range
              </label>
              {rangeMode === 'custom' && (
                <div className="exp-range">
                  <DatePicker value={customFrom} onChange={setCustomFrom} title="Range start" />
                  <span className="exp-dim">→</span>
                  <DatePicker value={customTo} onChange={setCustomTo} title="Range end" />
                </div>
              )}
              {!rangeValid && <div className="exp-err">Range start is after range end.</div>}
              <div className="exp-hint">
                Bars outside the period are clipped, not removed.
              </div>
            </section>

            {/* -------------------------------------------- left columns */}
            <section className="exp-group">
              <div className="exp-group-title">
                Left columns <span className="exp-dim">({lhsWidth(columns)} px wide)</span>
              </div>
              <div className="exp-cols">
                {COLUMN_ORDER.map(c => (
                  <label key={c} className="exp-check">
                    <input
                      type="checkbox"
                      checked={c === 'name' || columnSet.has(c)}
                      disabled={c === 'name'}
                      onChange={() => toggleColumn(c)}
                    />
                    {COLUMNS[c].label}
                  </label>
                ))}
              </div>
            </section>

            {/* ------------------------------------------------- timeline */}
            <section className="exp-group">
              <div className="exp-group-title">Timeline</div>
              <div className="exp-seg exp-seg--sm">
                {(['auto', 'day', 'week', 'month'] as UnitChoice[]).map(u => (
                  <button
                    key={u}
                    type="button"
                    className={unitChoice === u ? 'is-on' : ''}
                    onClick={() => setUnitChoice(u)}
                  >
                    {u === 'auto' ? `Auto (${unit})` : u[0].toUpperCase() + u.slice(1)}
                  </button>
                ))}
              </div>
              <label className="exp-check">
                <input type="checkbox" checked={showArrows} onChange={e => setShowArrows(e.target.checked)} />
                Dependency arrows
              </label>
              <label className="exp-check">
                <input type="checkbox" checked={showToday} onChange={e => setShowToday(e.target.checked)} />
                Today marker
              </label>
              <label className="exp-check">
                <input
                  type="checkbox"
                  checked={highlightCritical}
                  onChange={e => setHighlightCritical(e.target.checked)}
                />
                Critical path
              </label>
              {highlightCritical && (
                <div className="exp-seg exp-seg--sm">
                  <button
                    type="button"
                    className={critScope === 'project' ? 'is-on' : ''}
                    onClick={() => setCritScope('project')}
                  >
                    Whole project
                  </button>
                  <button
                    type="button"
                    className={critScope === 'export' ? 'is-on' : ''}
                    onClick={() => setCritScope('export')}
                  >
                    Exported tasks
                  </button>
                </div>
              )}
              <label className="exp-field">
                <span>Title</span>
                <input
                  type="text"
                  className="exp-input"
                  placeholder="optional heading"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </label>
            </section>

            {/* --------------------------------------------- format bits */}
            {format === 'pdf' ? (
              <section className="exp-group">
                <div className="exp-group-title">Page</div>
                <div className="exp-seg exp-seg--sm">
                  {(Object.keys(PAPER_LABELS) as PaperName[]).map(p => (
                    <button key={p} type="button" className={paper === p ? 'is-on' : ''} onClick={() => setPaper(p)}>
                      {PAPER_LABELS[p]}
                    </button>
                  ))}
                </div>
                <div className="exp-seg exp-seg--sm">
                  <button type="button" className={landscape ? 'is-on' : ''} onClick={() => setLandscape(true)}>Landscape</button>
                  <button type="button" className={!landscape ? 'is-on' : ''} onClick={() => setLandscape(false)}>Portrait</button>
                </div>
                <label className="exp-check">
                  <input type="checkbox" checked={multipage} onChange={e => setMultipage(e.target.checked)} />
                  Allow multiple pages
                </label>
                <div className="exp-hint">
                  {multipage
                    ? `Splits into ${pages} page${pages === 1 ? '' : 's'}; the left columns and the date header repeat on each one.`
                    : 'The whole chart is scaled down onto a single page.'}
                </div>
                <div className="exp-hint">
                  Export opens the print dialog. Choose “Save as PDF” as the destination.
                </div>
              </section>
            ) : (
              <section className="exp-group">
                <div className="exp-group-title">Image</div>
                <div className="exp-seg exp-seg--sm">
                  {[1, 2, 3].map(s => (
                    <button key={s} type="button" className={pngScale === s ? 'is-on' : ''} onClick={() => setPngScale(s)}>
                      {s}x
                    </button>
                  ))}
                </div>
                <div className="exp-hint">
                  {built ? `${pngW} × ${pngH} px` : 'Nothing to export'}
                  {realScale !== pngScale && ' (reduced to stay inside the browser canvas limit)'}
                </div>
              </section>
            )}
          </div>

          {/* ------------------------------------------------------ preview */}
          <div className="exp-preview-wrap">
            <div className="exp-group-title">Preview</div>
            <div className="exp-preview">
              {built
                ? <div dangerouslySetInnerHTML={{ __html: svgDocument(built) }} />
                : <p className="exp-empty">No tasks selected.</p>}
            </div>
            {built && (
              <div className="exp-hint">
                {selected.length} task{selected.length === 1 ? '' : 's'} · {built.width} × {built.height} px
              </div>
            )}
          </div>
        </div>

        <div className="exp-foot">
          {error && <span className="exp-err">{error}</span>}
          <div className="exp-head-spacer" />
          <button className="exp-btn" onClick={onClose} type="button">Cancel</button>
          <button
            className="exp-btn exp-btn--primary"
            onClick={runExport}
            disabled={!built || busy}
            type="button"
          >
            {busy ? 'Working…' : format === 'png' ? 'Download PNG' : 'Print / Save as PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
