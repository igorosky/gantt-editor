import { test, expect, row, savedTasks, clickBar, LIST_ID, type SeedTask } from './fixtures'
import type { Page } from '@playwright/test'

const TASKS: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'B', name: 'Beta', start: '2026-03-09', end: '2026-03-13', dependencies: ['A'] },
  { id: 'C', name: 'Gamma', start: '2026-03-16', end: '2026-03-20', dependencies: ['B'] },
  { id: 'D', name: 'Delta launch', start: '2026-03-04', end: '2026-03-10' },
]

const deps = async (page: Page) => Object.fromEntries((await savedTasks(page)).map(t => [t.id, t.dependencies ?? []]))
const popup = (page: Page) => page.locator('.tdp-modal')

async function openDetails(page: Page, id: string) {
  await clickBar(page, id, { clickCount: 2 })
  await expect(popup(page)).toBeVisible()
}

test('add a predecessor with fuzzy search; loops are offered greyed out', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await openDetails(page, 'C')
  await popup(page).getByRole('button', { name: 'Add predecessor' }).click()
  const picker = page.getByRole('dialog', { name: 'Add predecessor' })
  await picker.getByRole('combobox').fill('dl lnch')
  await expect(picker.getByRole('option').first()).toContainText('Delta launch')
  await expect(picker.locator('mark').first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await deps(page)).C).toEqual(['B', 'D'])
  await expect(popup(page).locator('.tdp-dep-chip', { hasText: 'Delta launch' })).toBeVisible()

  await popup(page).locator('.tdp-iconbtn--close').click()
  await openDetails(page, 'A')
  await popup(page).getByRole('button', { name: 'Add predecessor' }).click()
  const gamma = page.getByRole('dialog', { name: 'Add predecessor' }).getByRole('option', { name: /Gamma/ })
  await expect(gamma).toHaveAttribute('aria-disabled', 'true')
  await expect(gamma).toContainText('Would create a loop')
  await gamma.click({ force: true })
  expect((await deps(page)).A).toEqual([])
  // Escape closes the picker only
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Add predecessor' })).toHaveCount(0)
  await expect(popup(page)).toBeVisible()
})

test('add and remove a successor of an existing task', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await openDetails(page, 'D')
  await popup(page).getByRole('button', { name: 'Add successor' }).click()
  await page.getByRole('dialog', { name: 'Add successor' }).getByRole('option', { name: /Alpha/ }).click()
  await expect.poll(async () => (await deps(page)).A).toEqual(['D'])
  await expect(page.locator('path[data-from="D"][data-to="A"]')).toHaveCount(1)
  await popup(page).getByRole('button', { name: 'Remove Alpha from successors' }).click()
  await expect.poll(async () => (await deps(page)).A).toEqual([])
})

test('a new task takes predecessors and successors; discarding leaves nothing behind', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await page.getByRole('button', { name: '+ Add task' }).first().click()
  await popup(page).getByRole('button', { name: 'Add successor' }).click()
  await page.getByRole('dialog', { name: 'Add successor' }).getByRole('combobox').fill('gam')
  await page.keyboard.press('Enter')
  await expect(popup(page).locator('.tdp-dep-chip', { hasText: 'Gamma' })).toBeVisible()
  // The successor alone makes the draft worth asking about
  await popup(page).locator('.tdp-iconbtn--close').click()
  await expect(page.locator('.tdp-confirm')).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
  expect((await deps(page)).C).toEqual(['B'])

  await page.getByRole('button', { name: '+ Add task' }).first().click()
  await page.locator('.tdp-title').fill('Middle')
  await popup(page).getByRole('button', { name: 'Add predecessor' }).click()
  await page.getByRole('dialog', { name: 'Add predecessor' }).getByRole('combobox').fill('alpha')
  await page.keyboard.press('Enter')
  await popup(page).getByRole('button', { name: 'Add successor' }).click()
  await page.getByRole('dialog', { name: 'Add successor' }).getByRole('combobox').fill('gamma')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Create task' }).click()
  const created = (await savedTasks(page)).find(t => t.name === 'Middle')!
  expect(created.dependencies).toEqual(['A'])
  expect((await deps(page)).C).toEqual(['B', created.id])
  // One undo step takes back the task and the link
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await deps(page)).C).toEqual(['B'])
  expect((await savedTasks(page)).some(t => t.name === 'Middle')).toBe(false)
})

test('the menu opens the popup with the predecessor search ready', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await row(page, 'Delta launch').click({ button: 'right', position: { x: 80, y: 24 } })
  await page.locator('.ctx-menu__item', { hasText: 'Add predecessor…' }).click()
  const picker = page.getByRole('dialog', { name: 'Add predecessor' })
  await expect(picker.getByRole('combobox')).toBeFocused()
})

test('connect mode refuses a link that would close a loop', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await page.getByRole('button', { name: /Connect tasks/ }).click()
  await clickBar(page, 'C')
  await clickBar(page, 'A')
  await expect(page.locator('.toast')).toContainText('Would create a loop')
  expect((await deps(page)).A).toEqual([])
})

test('a late start is flagged until the setting is turned off', async ({ page, seed }) => {
  await seed({ tasks: [
    { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
    { id: 'B', name: 'Beta', start: '2026-03-05', end: '2026-03-09', dependencies: ['A'] },
  ] })
  const arrow = page.locator('path[data-from="A"][data-to="B"]')
  await expect(arrow).toHaveClass(/arrow--violation/)
  await expect(row(page, 'Beta').locator('.task-row__warning')).toHaveAttribute('title', /Starts before "Alpha" ends/)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Warn when a task starts before its predecessor ends').uncheck()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(arrow).not.toHaveClass(/arrow--violation/)
  // Other warnings (no description) may stay; the late start is gone
  await expect(row(page, 'Beta').locator('.task-row__warning')).not.toHaveAttribute('title', /Starts before/)
})

test('a new task on a linked board starts in the list default status and closes quietly', async ({ page, seed }) => {
  await seed({ tasks: TASKS, linked: true })
  await page.getByRole('button', { name: '+ Add task' }).first().click()
  await expect(popup(page).locator('.tdp-status-badge')).toContainText('to do')
  await popup(page).locator('.tdp-iconbtn--close').click()
  await expect(page.locator('.tdp-confirm')).toHaveCount(0)
  await expect(popup(page)).toHaveCount(0)
  await page.getByRole('button', { name: '+ Add task' }).first().click()
  await page.getByRole('button', { name: 'Create task' }).click()
  const t = (await savedTasks(page)).find(x => x.name === 'New task')!
  expect([t.status, t.statusColor, t.statusType]).toEqual(['to do', '#87909e', 'open'])
})

test('statuses arriving after the draft opened still give no discard prompt', async ({ page, seed, clickup }) => {
  clickup.on(async (route, url) => {
    if (url.pathname !== `/clickup/list/${LIST_ID}`) return false
    await new Promise(r => setTimeout(r, 1500))
    await route.fulfill({ json: { id: LIST_ID, statuses: [{ status: 'open', color: '#abc', orderindex: 0, type: 'open' }] } })
    return true
  })
  await seed({ tasks: TASKS, linked: true })
  await page.getByRole('button', { name: '+ Add task' }).first().click()
  await expect(popup(page).locator('.tdp-status-badge')).toContainText('open', { timeout: 5000 })
  await popup(page).locator('.tdp-iconbtn--close').click()
  await expect(page.locator('.tdp-confirm')).toHaveCount(0)
})

test('push sends a status picked on a new task after creating it', async ({ page, seed, clickup }) => {
  clickup.on(async (route, url, method) => {
    if (method === 'POST' && url.pathname === `/clickup/list/${LIST_ID}/task`) {
      await route.fulfill({ json: {
        id: 'cu-new', name: 'Fresh', start_date: null, due_date: null, date_updated: String(Date.now()),
        dependencies: [], parent: null, status: { status: 'to do', color: '#87909e', type: 'open' },
      } })
      return true
    }
    if (method === 'PUT' && url.pathname === '/clickup/task/cu-new') {
      await route.fulfill({ json: {
        id: 'cu-new', name: 'Fresh', start_date: null, due_date: null, date_updated: String(Date.now()),
        dependencies: [], parent: null, status: { status: 'in progress', color: '#5f55ee', type: 'custom' },
      } })
      return true
    }
    return false
  })
  await seed({ tasks: [{ id: 'N', name: 'Fresh', status: 'in progress', statusColor: '#5f55ee', statusType: 'custom' }], linked: true })
  await page.getByRole('button', { name: '↑ Push' }).click()
  await expect(page.locator('.app__sync-report')).toBeVisible()
  const writes = clickup.calls.filter(c => c.method !== 'GET').map(c => [c.method, c.path, (c.body as any)?.status])
  expect(writes).toEqual([
    ['POST', `/list/${LIST_ID}/task`, undefined],
    ['PUT', '/task/cu-new', 'in progress'],
  ])
  await expect.poll(async () => (await savedTasks(page))[0].clickupId).toBe('cu-new')
})
