import type { TaskWarning } from '../lib/warnings'

interface Props {
  warnings: TaskWarning[]
}

export function TaskWarnings({ warnings }: Props) {
  if (warnings.length === 0) return null
  const title = warnings.map(w => w.message).join('\n')
  return (
    <span
      className="task-row__warning"
      title={title}
      aria-label={title}
      role="img"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path
          d="M7 1.2 L13 12.5 L1 12.5 Z"
          fill="#e55"
          stroke="#a22"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        <rect x="6.35" y="5.3" width="1.3" height="3.6" fill="#fff" rx="0.3" />
        <rect x="6.35" y="9.7" width="1.3" height="1.3" fill="#fff" rx="0.3" />
      </svg>
    </span>
  )
}
