import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// A ClickUp workspace member as the board knows them
export interface Person {
  id: number
  username: string
  email?: string
  profilePicture?: string | null
  color?: string
}

// Workspace members by ClickUp user id, for profile pictures. Presentation
// only: assignees on tasks keep just { id, username }.
export const PeopleContext = createContext<ReadonlyMap<number, Person>>(new Map())

export function initials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('') || '?'
}

const COLORS = ['#7c85f5', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7']

// A stable color per name, for people without a ClickUp color
export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return COLORS[Math.abs(h) % COLORS.length]
}

interface Props {
  person: { id: number; username: string }
  size?: number
  title?: string // default: the username
  pictures?: boolean // false = initials only
}

// Profile picture when ClickUp has one (and it loads), else colored initials
export function Avatar({ person, size = 22, title, pictures = true }: Props) {
  const people = useContext(PeopleContext)
  const known = person.id !== -1 ? people.get(person.id) : undefined
  const url = pictures ? known?.profilePicture ?? undefined : undefined
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  const name = known?.username ?? person.username
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(8, Math.round(size * 0.42)),
    background: known?.color ?? avatarColor(name),
  }
  return (
    <span className="avatar" style={style} title={title ?? name} aria-label={name} role="img">
      {url && !broken
        ? <img className="avatar__img" src={url} alt="" draggable={false} onError={() => setBroken(true)} />
        : initials(name)}
    </span>
  )
}

// Up to `max` overlapping avatars, then "+N"
export function AvatarStack({ people, max = 3, size = 20, pictures = true }: {
  people: Array<{ id: number; username: string }>
  max?: number
  size?: number
  pictures?: boolean
}) {
  if (!people.length) return null
  const shown = people.slice(0, max)
  const more = people.length - shown.length
  return (
    <span className="avatar-stack" title={people.map(p => p.username).join(', ')}>
      {shown.map(p => <Avatar key={`${p.id}:${p.username}`} person={p} size={size} title="" pictures={pictures} />)}
      {more > 0 && (
        <span className="avatar avatar--more" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
          +{more}
        </span>
      )}
    </span>
  )
}

// "u:123" (portfolio assignee key) -> 123; other keys have no ClickUp user
export const personIdOfKey = (key: string): number | null =>
  key.startsWith('u:') && /^\d+$/.test(key.slice(2)) ? Number(key.slice(2)) : null

// The profile picture of a user id, or `fallback` (no picture, failed load,
// pictures off), for places with a look of their own
export function ProfilePicture({ id, size, fallback, enabled = true }: {
  id: number | null
  size: number
  fallback: ReactNode
  enabled?: boolean
}) {
  const people = useContext(PeopleContext)
  const url = enabled && id !== null ? people.get(id)?.profilePicture ?? undefined : undefined
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  if (!url || broken) return <>{fallback}</>
  return (
    <img className="avatar__img avatar__img--round" src={url} width={size} height={size} alt="" draggable={false}
      onError={() => setBroken(true)} />
  )
}
