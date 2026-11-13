import { test, expect, bar, row, rowDates, savedTasks, center, clickBar, type SeedTask } from './fixtures'
import type { Page } from '@playwright/test'

const TASKS: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'B', name: 'Beta', start: '2026-03-09', end: '2026-03-13', dependencies: ['A'] },
  { id: 'C', name: 'Gamma', start: '2026-03-16', end: '2026-03-20', dependencies: ['B'] },
  { id: 'D', name: 'Delta', start: '2026-03-04', end: '2026-03-10' },
]

const menu = (page: Page) => page.getByRole('menu').first()
const items = (page: Page) => menu(page).getByRole('menuitem').evaluateAll(els => els.map(e => e.textContent?.trim()))

async function rowMenu(page: Page, name: string) {
  await row(page, name).click({ button: 'right', position: { x: 80, y: 24 } })
  await expect(menu(page)).toBeVisible()
}

async function barMenu(page: Page, id: string) {
  const { x, y } = await center(page, `.bar-wrapper[data-id="${id}"] .bar`)
  await page.mouse.click(x, y, { button: 'right' })
  await expect(menu(page)).toBeVisible()
}

// A menu item by its exact label (hints and checks aside)
const item = (page: Page, label: string) => page.locator('.ctx-menu__item', {
  has: page.locator('.ctx-menu__label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
}).last()

async function pick(page: Page, ...path: string[]) {
  for (const label of path) await item(page, label).click()
}

test('row right-click, the ⋯ button and bar right-click open the same menu', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await rowMenu(page, 'Beta')
  const fromRow = await items(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  await row(page, 'Beta').hover()
  await row(page, 'Beta').getByRole('button', { name: /More actions/ }).click()
  expect(await items(page)).toEqual(fromRow)
  await page.keyboard.press('Escape')

  await barMenu(page, 'B')
  expect(await items(page)).toEqual(fromRow)
  expect(fromRow.join('|')).toContain('Open details')
  // The menu target became the selection; Escape on the menu kept it
  await expect(bar(page, 'B')).toHaveClass(/is-selected/)
})

test('the menu works from the keyboard', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await rowMenu(page, 'Delta')
  await page.keyboard.press('ArrowDown') // Rename
  await page.keyboard.press('Enter')
  await expect(page.locator('.task-row__name-input')).toBeVisible()
  await page.keyboard.press('Escape')
  await rowMenu(page, 'Delta')
  await page.keyboard.press('Enter') // Open details
  await expect(page.getByRole('dialog', { name: 'Task details: Delta' })).toBeVisible()
})

test('highlight path dims everything off it; Escape clears the path, then the selection', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await barMenu(page, 'B')
  await item(page, 'Highlight path').hover()
  await pick(page, 'Upstream and downstream')
  await expect(page.locator('.gantt-panel__path-chip')).toContainText('Path of "Beta" · 3 tasks')
  await expect(bar(page, 'D')).toHaveClass(/is-dimmed/)
  await expect(bar(page, 'A')).not.toHaveClass(/is-dimmed/)
  await expect(row(page, 'Delta')).toHaveClass(/task-row--dimmed/)
  await expect(page.locator('path[data-from="A"][data-to="B"]')).toHaveClass(/arrow--path/)
  await page.keyboard.press('Escape')
  await expect(page.locator('.gantt-panel__path-chip')).toHaveCount(0)
  await expect(bar(page, 'B')).toHaveClass(/is-selected/)
  await page.keyboard.press('Escape')
  await expect(bar(page, 'B')).not.toHaveClass(/is-selected/)

  // P toggles the path of the selection; upstream only from the submenu
  await clickBar(page, 'C')
  await page.keyboard.press('p')
  await expect(page.locator('.gantt-panel__path-chip')).toContainText('3 tasks')
  await page.keyboard.press('p')
  await expect(page.locator('.gantt-panel__path-chip')).toHaveCount(0)
  await barMenu(page, 'B')
  await item(page, 'Highlight path').hover()
  await pick(page, 'Downstream only')
  await expect(page.locator('.gantt-panel__path-chip')).toContainText('2 tasks')
  await expect(bar(page, 'A')).toHaveClass(/is-dimmed/)
})

test('select the whole path', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await barMenu(page, 'A')
  await item(page, 'Highlight path').hover()
  await pick(page, 'Select the whole path')
  await expect(page.locator('.bar-wrapper.is-selected')).toHaveCount(3)
})

test('bulk priority is one undo step', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await clickBar(page, 'A')
  await clickBar(page, 'C', { modifiers: ['Shift'] })
  await barMenu(page, 'B')
  await expect(page.getByRole('menuitem', { name: 'Delete 3 tasks' })).toBeVisible()
  await item(page, 'Set priority').hover()
  await pick(page, 'High')
  await expect.poll(async () => (await savedTasks(page)).filter(t => t.priority === 2).map(t => t.id)).toEqual(['A', 'B', 'C'])
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await savedTasks(page)).filter(t => t.priority).length).toBe(0)
})

test('shift dates moves the selection with its successors once', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await clickBar(page, 'A')
  await clickBar(page, 'B', { modifiers: ['Control'] })
  await barMenu(page, 'A')
  await pick(page, 'Shift dates…')
  const dialog = page.getByRole('dialog', { name: 'Shift dates' })
  await expect(dialog).toContainText('1 successor')
  await dialog.getByLabel('Days').fill('3')
  await dialog.getByRole('button', { name: 'Shift' }).click()
  await expect.poll(() => rowDates(page, 'Alpha')).toEqual(['05.03.2026', '09.03.2026'])
  expect(await rowDates(page, 'Beta')).toEqual(['12.03.2026', '16.03.2026'])
  expect(await rowDates(page, 'Gamma')).toEqual(['19.03.2026', '23.03.2026'])
  expect(await rowDates(page, 'Delta')).toEqual(['04.03.2026', '10.03.2026'])
  await page.keyboard.press('Control+z')
  await expect.poll(() => rowDates(page, 'Gamma')).toEqual(['16.03.2026', '20.03.2026'])
})

test('link as chain in row order skips links that would loop; unlink removes links within', async ({ page, seed }) => {
  await seed({ tasks: [
    { id: 'Q', name: 'Que', start: '2026-03-02', end: '2026-03-03', dependencies: ['P'] },
    { id: 'P', name: 'Pea', start: '2026-03-04', end: '2026-03-05' },
    { id: 'X', name: 'Ex', start: '2026-03-06', end: '2026-03-07' },
  ] })
  await row(page, 'Que').click({ position: { x: 80, y: 24 } })
  await row(page, 'Ex').click({ position: { x: 80, y: 24 }, modifiers: ['Shift'] })
  await rowMenu(page, 'Pea')
  await pick(page, 'Link as chain')
  await expect(page.locator('.toast')).toContainText('Added 1 link, skipped 1 that would create a loop')
  const deps = async () => Object.fromEntries((await savedTasks(page)).map(t => [t.id, t.dependencies ?? []]))
  expect(await deps()).toEqual({ Q: ['P'], P: [], X: ['P'] })
  await rowMenu(page, 'Pea')
  await pick(page, 'Unlink selected')
  expect(await deps()).toEqual({ Q: [], P: [], X: [] })
})

test('Delete removes the selection after confirming; the toast undoes it', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  page.once('dialog', d => d.accept())
  await clickBar(page, 'A')
  await clickBar(page, 'D', { modifiers: ['Control'] })
  await page.keyboard.press('Delete')
  await expect(row(page, 'Alpha')).toHaveCount(0)
  await expect(row(page, 'Delta')).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
  await expect(row(page, 'Alpha')).toHaveCount(1)
  await expect(row(page, 'Delta')).toHaveCount(1)
})

test('start after predecessors moves a late successor and its chain', async ({ page, seed }) => {
  await seed({ tasks: [
    { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
    { id: 'B', name: 'Beta', start: '2026-03-04', end: '2026-03-05', dependencies: ['A'] },
    { id: 'C', name: 'Gamma', start: '2026-03-09', end: '2026-03-10', dependencies: ['B'] },
  ] })
  await rowMenu(page, 'Beta')
  await pick(page, 'Start after predecessors')
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['07.03.2026', '08.03.2026'])
  expect(await rowDates(page, 'Gamma')).toEqual(['12.03.2026', '13.03.2026'])
})

test('linked board: status and assignees from the menu, with profile pictures', async ({ page, seed }) => {
  await seed({ tasks: TASKS, linked: true })
  await clickBar(page, 'A')
  await clickBar(page, 'D', { modifiers: ['Control'] })
  await barMenu(page, 'A')
  await item(page, 'Set status').hover()
  await pick(page, 'in progress')
  await expect.poll(async () => (await savedTasks(page)).filter(t => t.status === 'in progress').map(t => [t.id, t.statusColor]))
    .toEqual([['A', '#5f55ee'], ['D', '#5f55ee']])

  await barMenu(page, 'A')
  await pick(page, 'Assign…')
  const picker = page.locator('.floating-picker')
  await expect(picker.locator('.tdp-picker-item')).toHaveCount(3)
  await expect(picker.locator('.tdp-picker-item', { hasText: 'Alice Smith' }).locator('img')).toHaveCount(1)
  // Bob's picture is broken: initials instead
  await expect(picker.locator('.tdp-picker-item', { hasText: 'Bob Jones' }).locator('img')).toHaveCount(0)
  await expect(picker.locator('.tdp-picker-item', { hasText: 'Bob Jones' })).toContainText('BJ')
  await picker.locator('.tdp-picker-item', { hasText: 'Alice Smith' }).click()
  await expect.poll(async () => (await savedTasks(page)).filter(t => t.assignees?.[0]?.id === 101).map(t => t.id)).toEqual(['A', 'D'])
  await expect(picker.locator('.tdp-picker-item', { hasText: 'Alice Smith' })).toContainText('✓')
  await picker.locator('.tdp-picker-item', { hasText: 'Alice Smith' }).click()
  await expect.poll(async () => (await savedTasks(page)).filter(t => t.assignees?.length).length).toBe(0)
})
