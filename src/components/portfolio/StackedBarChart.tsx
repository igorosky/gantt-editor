import { useMemo } from 'react'
import { niceTicks, Tooltip, useElementWidth, useTooltip } from './shared'

export interface Series {
  key: string
  label: string
  color: string
}

export interface BarBucket {
  label: string // x-axis label
  title: string // tooltip heading
  values: Record<string, number>
  total: number
  isToday?: boolean
}

interface Props {
  buckets: BarBucket[]
  series: Series[] // bottom-up stacking order
  format: (v: number) => string
  height?: number
  selected?: number | null
  onSelect?: (i: number | null) => void
  // Optional row of per-bucket numbers drawn under the x axis
  band?: { label: string; values: number[]; max: number }
}

const PAD_L = 44
const PAD_R = 12
const PAD_T = 12
const AXIS_H = 22
const BAND_H = 22
const MIN_SLOT = 10
const MAX_BAR = 24
const GAP = 2 // surface gap between stacked segments
const LABEL_W = 46

// Same blue ramp the people heatmap uses (light end)
const BAND_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95']

export function StackedBarChart({ buckets, series, format, height = 260, selected, onSelect, band }: Props) {
  const [wrapRef, wrapW] = useElementWidth<HTMLDivElement>()
  const { tip, show, hide } = useTooltip()

  const n = buckets.length
  const innerW = Math.max((wrapW || 600) - PAD_L - PAD_R, n * MIN_SLOT)
  const slot = n ? innerW / n : 0
  const barW = Math.max(4, Math.min(MAX_BAR, slot * 0.7))
  const plotH = height - PAD_T - AXIS_H - (band ? BAND_H + 6 : 0)
  const max = Math.max(...buckets.map(b => b.total), 0)
  const ticks = useMemo(() => niceTicks(max), [max])
  const top = ticks[ticks.length - 1] || 1
  const y = (v: number) => PAD_T + plotH - (v / top) * plotH
  const labelEvery = Math.max(1, Math.ceil(LABEL_W / Math.max(slot, 1)))
  const svgW = PAD_L + innerW + PAD_R
  const todayIdx = buckets.findIndex(b => b.isToday)

  function tipContent(b: BarBucket) {
    const rows = series.filter(s => (b.values[s.key] ?? 0) > 0).reverse()
    return (
      <>
        <div className="pf-tip__title">{b.title}</div>
        {rows.map(s => (
          <div key={s.key} className="pf-tip__row">
            <span className="pf-dot pf-dot--sm" style={{ background: s.color }} />
            <span className="pf-tip__label">{s.label}</span>
            <span className="pf-tip__val">{format(b.values[s.key])}</span>
          </div>
        ))}
        <div className="pf-tip__row pf-tip__total">
          <span className="pf-tip__label">Total</span>
          <span className="pf-tip__val">{format(b.total)}</span>
        </div>
        {onSelect && <div className="pf-tip__hint">Click to list tasks</div>}
      </>
    )
  }

  return (
    <div className="pf-chart" ref={wrapRef}>
      <svg width={svgW} height={height} role="img" aria-label="Workload chart" className="pf-chart__svg">
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD_L} x2={PAD_L + innerW} y1={y(t)} y2={y(t)} className={t === 0 ? 'pf-axis' : 'pf-grid'} />
            <text x={PAD_L - 6} y={y(t) + 4} textAnchor="end" className="pf-tick">{format(t)}</text>
          </g>
        ))}

        {todayIdx >= 0 && (
          <line x1={PAD_L + slot * (todayIdx + 0.5)} x2={PAD_L + slot * (todayIdx + 0.5)}
            y1={PAD_T - 4} y2={PAD_T + plotH} className="pf-today" />
        )}

        {buckets.map((b, i) => {
          const cx = PAD_L + slot * (i + 0.5)
          const x = cx - barW / 2
          let acc = 0
          const segs = series
            .map(s => ({ s, v: b.values[s.key] ?? 0 }))
            .filter(d => d.v > 0)
          return (
            <g key={i}
              className={`pf-bar${selected === i ? ' is-selected' : ''}`}
              onMouseMove={e => show(e, tipContent(b))}
              onMouseLeave={hide}
              onClick={() => onSelect?.(selected === i ? null : i)}>
              {/* Hit target spans the whole slot, larger than the mark */}
              <rect x={PAD_L + slot * i} y={PAD_T} width={slot} height={plotH} className="pf-hit" />
              {segs.map((d, si) => {
                const y0 = y(acc)
                acc += d.v
                const y1 = y(acc)
                const isTop = si === segs.length - 1
                const h = Math.max(0, y0 - y1 - (isTop ? 0 : GAP))
                if (h <= 0) return null
                return isTop
                  ? <path key={d.s.key} d={roundedTop(x, y1, barW, h, Math.min(4, h, barW / 2))} fill={d.s.color} />
                  : <rect key={d.s.key} x={x} y={y1 + GAP} width={barW} height={h} fill={d.s.color} />
              })}
            </g>
          )
        })}

        {/* Today's label always shows; regular labels too close to it give way */}
        {buckets.map((b, i) => (b.isToday || (i % labelEvery === 0 && (todayIdx < 0 || Math.abs(i - todayIdx) >= labelEvery)) ? (
          <text key={i} x={PAD_L + slot * (i + 0.5)} y={PAD_T + plotH + 15} textAnchor="middle"
            className={`pf-tick${b.isToday ? ' pf-tick--today' : ''}`}>
            {b.label}
          </text>
        ) : null))}

        {band && (
          <g>
            <text x={PAD_L - 6} y={PAD_T + plotH + AXIS_H + 15} textAnchor="end" className="pf-tick">{band.label}</text>
            {band.values.map((v, i) => {
              const step = v === 0 ? -1 : Math.min(BAND_RAMP.length - 1, Math.floor((v / Math.max(1, band.max)) * (BAND_RAMP.length - 1)))
              const cellX = PAD_L + slot * i + 1
              const cellW = Math.max(1, slot - 2)
              return (
                <g key={i}>
                  <rect x={cellX} y={PAD_T + plotH + AXIS_H} width={cellW} height={BAND_H} rx={3}
                    fill={step < 0 ? 'var(--surface-3)' : BAND_RAMP[step]} />
                  {slot >= 16 && v > 0 && (
                    <text x={cellX + cellW / 2} y={PAD_T + plotH + AXIS_H + 15} textAnchor="middle"
                      className="pf-band-num" fill={step >= 3 ? '#fff' : 'var(--text)'}>{v}</text>
                  )}
                </g>
              )
            })}
          </g>
        )}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

// Bar with 4px rounded data end and square baseline
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null
  return (
    <div className="pf-legend">
      {series.map(s => (
        <span key={s.key} className="pf-legend__item">
          <span className="pf-legend__swatch" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}
