import { test as base, expect, type Page, type Route } from '@playwright/test'

// Fixed "now" for every spec: Wednesday 4 March 2026, 10:00 Warsaw time
export const NOW = new Date('2026-03-04T10:00:00+01:00')

export const BOARD_ID = 'board-e2e'
export const LIST_ID = 'list-1'
export const TEAM_ID = 'team-1'
export const SPACE_ID = 'space-1'

export interface SeedTask {
  id: string
  name: string
  start?: string // YYYY-MM-DD, local midnight
  end?: string
  type?: 'task' | 'milestone'
  dependencies?: string[]
  parentId?: string
  status?: string
  statusColor?: string
  statusType?: string
  priority?: 1 | 2 | 3 | 4
  assignees?: { id: number; username: string }[]
  tags?: { name: string; tag_bg?: string }[]
  description?: string
  clickupId?: string
  remoteParent?: string | null
}

export interface Seed {
  tasks: SeedTask[]
  linked?: boolean // board linked to LIST_ID with a ClickUp token
  storage?: Record<string, unknown> // extra localStorage entries (JSON-encoded)
}

// Dates as strings without a zone: the app's `new Date()` reads them as
// local midnight in the browser (Europe/Warsaw), as its date pickers store them
const local = (d: string) => `${d}T00:00:00`

function serialize(tasks: SeedTask[]) {
  return tasks.map(t => ({
    progress: 0,
    ...t,
    ...(t.start ? { start: local(t.start) } : {}),
    ...(t.end ? { end: local(t.end) } : {}),
  }))
}

export const STATUSES = [
  { status: 'to do', color: '#87909e', orderindex: 0, type: 'open' },
  { status: 'in progress', color: '#5f55ee', orderindex: 1, type: 'custom' },
  { status: 'complete', color: '#008844', orderindex: 2, type: 'closed' },
]

export const MEMBERS = [
  { id: 101, username: 'Alice Smith', email: 'alice@example.com', color: '#7b68ee', profilePicture: 'https://attachments.clickup.com/profilePictures/101_a.png' },
  { id: 102, username: 'Bob Jones', email: 'bob@example.com', color: '#ff7800', profilePicture: 'https://attachments.clickup.com/profilePictures/102_broken.png' },
  { id: 103, username: 'Carol White', email: 'carol@example.com', color: '#0ab' , profilePicture: null },
]

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export type ClickUpHandler = (route: Route, url: URL, method: string) => Promise<boolean | void> | boolean | void

export class ClickUpMock {
  unmocked: string[] = []
  calls: { method: string; path: string; body?: unknown }[] = []
  handlers: ClickUpHandler[] = []
  remoteTasks: unknown[] = []

  on(h: ClickUpHandler) { this.handlers.push(h) }

  async handle(route: Route) {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const path = url.pathname.replace(/^\/clickup/, '')
    let body: unknown
    try { body = route.request().postDataJSON() } catch { body = undefined }
    this.calls.push({ method, path, body })
    for (const h of this.handlers) {
      if (await h(route, url, method)) return
    }
    if (method === 'GET' && path === '/team') {
      return route.fulfill({ json: { teams: [{ id: TEAM_ID, name: 'Team', members: MEMBERS.map(user => ({ user })) }] } })
    }
    if (method === 'GET' && path === `/list/${LIST_ID}`) {
      return route.fulfill({ json: { id: LIST_ID, name: 'E2E list', statuses: STATUSES } })
    }
    if (method === 'GET' && path === `/list/${LIST_ID}/task`) {
      const page = Number(url.searchParams.get('page') ?? 0)
      return route.fulfill({ json: { tasks: page === 0 ? this.remoteTasks : [] } })
    }
    if (method === 'GET' && path === `/space/${SPACE_ID}/tag`) {
      return route.fulfill({ json: { tags: [{ name: 'backend', tag_bg: '#f00', tag_fg: '#fff' }] } })
    }
    this.unmocked.push(`${method} ${path}`)
    return route.abort()
  }
}

interface Fixtures {
  seed: (s: Seed) => Promise<void>
  clickup: ClickUpMock
  errors: string[]
}

export const test = base.extend<Fixtures>({
  errors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    page.on('console', m => {
      if (m.type() !== 'error') return
      const text = m.text()
      // The broken avatar on purpose, and aborted requests the mock reports itself
      if (/Failed to load resource/.test(text)) return
      errors.push(`console: ${text}`)
    })
    await use(errors)
    expect(errors, 'page errors').toEqual([])
  },
  clickup: async ({ page }, use) => {
    const mock = new ClickUpMock()
    await page.route('**/clickup/**', route => mock.handle(route))
    await page.route('https://attachments.clickup.com/**', route =>
      route.request().url().includes('broken')
        ? route.fulfill({ status: 404, body: '' })
        : route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await use(mock)
    expect(mock.unmocked, 'unmocked ClickUp requests').toEqual([])
  },
  seed: async ({ page, clickup, errors }, use) => {
    void clickup
    void errors
    await use(async (s: Seed) => {
      await page.clock.setFixedTime(NOW)
      const board = s.linked
        ? { id: BOARD_ID, name: 'E2E list', listId: LIST_ID, spaceId: SPACE_ID, lastSyncAt: NOW.toISOString(), openedAt: NOW.toISOString() }
        : { id: BOARD_ID, name: 'E2E board', openedAt: NOW.toISOString() }
      const entries: Record<string, string> = {
        'gantt-boards': JSON.stringify({ current: BOARD_ID, boards: [board] }),
        [`gantt-tasks@${BOARD_ID}`]: JSON.stringify(serialize(s.tasks)),
        ...(s.linked ? { 'clickup-config': JSON.stringify({ token: 'pk_test', teamId: TEAM_ID }) } : {}),
      }
      for (const [k, v] of Object.entries(s.storage ?? {})) entries[k] = JSON.stringify(v)
      // Seed once per tab: reloads keep what the app saved since
      await page.addInitScript((e: Record<string, string>) => {
        if (sessionStorage.getItem('__e2e_seeded')) return
        localStorage.clear()
        for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v)
        sessionStorage.setItem('__e2e_seeded', '1')
      }, entries)
      await page.goto('/')
      await page.locator('.gantt-container').waitFor()
      await settle(page)
    })
  },
})

export { expect }

// ---- helpers ---------------------------------------------------------------

// frappe smooth-scrolls to today after a render: wait until the chart stops
// moving, or pointer coordinates taken now are stale a moment later
export async function settle(page: Page) {
  await page.waitForFunction(() => {
    const c = document.querySelector('.gantt-container') as HTMLElement | null
    if (!c) return true
    const w = window as unknown as { __e2eLast?: string; __e2eSame?: number }
    const sig = `${c.scrollLeft}:${c.scrollTop}`
    w.__e2eSame = w.__e2eLast === sig ? (w.__e2eSame ?? 0) + 1 : 0
    w.__e2eLast = sig
    return w.__e2eSame >= 3
  }, undefined, { polling: 100 })
  await barsGrown(page)
}

// On a new chart svg (page load, back from Portfolio, the chart coming back
// after an empty board) frappe grows every bar from width 0 by SMIL
// (`animateSVG`: begin 0.1s, 0.4s long, on the svg's own timeline). A bar box
// read meanwhile is too narrow, and its centre can land on the 3 px left
// resize handle: a drag then becomes a left-edge resize.
export async function barsGrown(page: Page) {
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg.gantt') as SVGSVGElement | null
    return !svg || svg.getCurrentTime() >= 0.55
  })
}

// Clicks the middle of a bar (the label sits on top of it)
export async function clickBar(page: Page, id: string, opts: { modifiers?: Array<'Shift' | 'Control' | 'Meta'>; button?: 'left' | 'right'; clickCount?: number } = {}) {
  const { x, y } = await center(page, `.bar-wrapper[data-id="${id}"] .bar`)
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m)
  await page.mouse.click(x, y, { button: opts.button ?? 'left', clickCount: opts.clickCount ?? 1 })
  for (const m of opts.modifiers ?? []) await page.keyboard.up(m)
}

export const bar = (page: Page, id: string) => page.locator(`.bar-wrapper[data-id="${id}"]`)
export const row = (page: Page, name: string) => page.locator('.task-row', { has: page.locator('.task-row__name', { hasText: new RegExp(`^${escapeRe(name)}$`) }) })

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The [start, due] texts of a row's date inputs (DD.MM.YYYY)
export async function rowDates(page: Page, name: string): Promise<string[]> {
  return row(page, name).locator('.task-row__dates input.task-row__date-input:not(.task-row__date-ghost *)').evaluateAll(
    els => els.map(e => (e as HTMLInputElement).value),
  )
}

// Saved tasks of the e2e board
export async function savedTasks(page: Page): Promise<Array<Record<string, any>>> {
  return page.evaluate(id => JSON.parse(localStorage.getItem(`gantt-tasks@${id}`) ?? '[]'), BOARD_ID)
}

// Drags from the centre of a locator by dx pixels, in small steps like a user
export async function dragBy(page: Page, x: number, y: number, dx: number, dy = 0) {
  await page.mouse.move(x, y)
  await page.mouse.down()
  const steps = 10
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps)
  await page.mouse.up()
}

export async function center(page: Page, selector: string) {
  await barsGrown(page)
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`no box for ${selector}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
}

// Scrolls the gantt so the bar is in view horizontally
export async function revealBar(page: Page, id: string) {
  await page.evaluate(tid => {
    const c = document.querySelector('.gantt-container') as HTMLElement
    const b = document.querySelector(`.bar-wrapper[data-id="${tid}"] .bar`) as SVGGraphicsElement | null
    if (!c || !b) return
    const x = Number(b.getAttribute('x'))
    c.scrollLeft = Math.max(0, x - 200)
  }, id)
}
