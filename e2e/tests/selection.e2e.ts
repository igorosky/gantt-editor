import { test, expect, bar, row, rowDates, dragBy, center, clickBar, type SeedTask } from './fixtures'

const TASKS: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'B', name: 'Beta', start: '2026-03-09', end: '2026-03-13', dependencies: ['A'] },
  { id: 'C', name: 'Gamma', start: '2026-03-16', end: '2026-03-20', dependencies: ['B'] },
  { id: 'D', name: 'Delta', start: '2026-03-04', end: '2026-03-10' },
]
const DAY = 20

const selectedRows = (page: import('@playwright/test').Page) =>
  page.locator('.task-row--selected .task-row__name-text').allInnerTexts()
const selectedBars = (page: import('@playwright/test').Page) =>
  page.locator('.bar-wrapper.is-selected').evaluateAll(els => els.map(e => e.getAttribute('data-id')).sort())

test('a row click selects the task in both panels and highlights its arrows', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await row(page, 'Beta').locator('.task-row__name-text').click()
  expect(await selectedRows(page)).toEqual(['Beta'])
  expect(await selectedBars(page)).toEqual(['B'])
  await expect(page.locator('path[data-from="A"][data-to="B"]')).toHaveClass(/arrow--sel-in/)
  await expect(page.locator('path[data-from="B"][data-to="C"]')).toHaveClass(/arrow--sel-out/)
  await expect(page.locator('.gantt-panel')).toHaveClass(/gantt-panel--has-selection/)
  // A single click does not rename any more
  await expect(page.locator('.task-row__name-input')).toHaveCount(0)
})

test('Shift selects a range and Ctrl toggles, in rows and on bars', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await row(page, 'Alpha').click({ position: { x: 60, y: 24 } })
  await row(page, 'Gamma').click({ position: { x: 60, y: 24 }, modifiers: ['Shift'] })
  expect(await selectedBars(page)).toEqual(['A', 'B', 'C'])
  await row(page, 'Beta').click({ position: { x: 60, y: 24 }, modifiers: ['Control'] })
  expect(await selectedBars(page)).toEqual(['A', 'C'])

  await clickBar(page, 'D')
  expect(await selectedBars(page)).toEqual(['D'])
  await clickBar(page, 'B', { modifiers: ['Shift'] })
  expect(await selectedBars(page)).toEqual(['B', 'C', 'D'])
  await clickBar(page, 'C', { modifiers: ['Control'] })
  expect(await selectedBars(page)).toEqual(['B', 'D'])
  expect((await selectedRows(page)).sort()).toEqual(['Beta', 'Delta'])
})

test('empty chart, empty list and Escape clear the selection', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await clickBar(page, 'A')
  expect(await selectedBars(page)).toEqual(['A'])
  await page.locator('.gantt-container').click({ position: { x: 30, y: 400 } })
  expect(await selectedBars(page)).toEqual([])

  await clickBar(page, 'A')
  await page.locator('.task-panel__list').click({ position: { x: 100, y: 400 } })
  expect(await selectedBars(page)).toEqual([])

  await clickBar(page, 'A')
  await page.keyboard.press('Escape')
  expect(await selectedBars(page)).toEqual([])
})

test('double-clicking a bar opens its details; Enter opens the selected task', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await clickBar(page, 'B', { clickCount: 2 })
  await expect(page.getByRole('dialog', { name: 'Task details: Beta' })).toBeVisible()
  await page.locator('.tdp-iconbtn--close').click()
  await clickBar(page, 'D')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Task details: Delta' })).toBeVisible()
})

test('a drag neither selects nor opens the bar', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  const { x, y } = await center(page, '.bar-wrapper[data-id="D"] .bar')
  await dragBy(page, x, y, 2 * DAY)
  await expect.poll(() => rowDates(page, 'Delta')).toEqual(['06.03.2026', '12.03.2026'])
  expect(await selectedBars(page)).toEqual([])
  await expect(page.locator('.tdp-modal')).toHaveCount(0)
})

test('a right press does not drag the bar', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  const { x, y } = await center(page, '.bar-wrapper[data-id="D"] .bar')
  await page.mouse.move(x, y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(x + 100, y, { steps: 8 })
  await page.mouse.up({ button: 'right' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  expect(await rowDates(page, 'Delta')).toEqual(['04.03.2026', '10.03.2026'])
})

test('rename by double-click on the name or F2', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await row(page, 'Alpha').locator('.task-row__name-text').dblclick()
  const input = page.locator('.task-row__name-input')
  await expect(input).toBeVisible()
  await input.fill('Alpha 2')
  await input.press('Enter')
  await expect(row(page, 'Alpha 2')).toHaveCount(1)
  // The Enter that commits the name does not also open the selected task
  await expect(page.locator('.tdp-modal')).toHaveCount(0)

  await clickBar(page, 'D')
  await page.keyboard.press('F2')
  await expect(input).toBeVisible()
  await input.fill('Delta 2')
  await input.press('Enter')
  await expect(row(page, 'Delta 2')).toHaveCount(1)
})

test('connect mode keeps priority: bar clicks link, Escape leaves it and keeps the selection', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await clickBar(page, 'D')
  await page.getByRole('button', { name: /Connect tasks/ }).click()
  await clickBar(page, 'A')
  expect(await selectedBars(page)).toEqual(['D'])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /Connect tasks/ })).toBeVisible()
  expect(await selectedBars(page)).toEqual(['D'])
})

test('hover highlights the row and bar together and shows a tooltip', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await row(page, 'Delta').hover()
  await expect(bar(page, 'D')).toHaveClass(/is-hover/)
  const { x, y } = await center(page, '.bar-wrapper[data-id="B"] .bar')
  await page.mouse.move(x, y)
  await expect(row(page, 'Beta')).toHaveClass(/is-hover/)
  const tip = page.getByRole('tooltip')
  await expect(tip).toContainText('Beta')
  await expect(tip).toContainText('9 Mar – 13 Mar')
  await expect(tip).toContainText('5 days')
  await expect(tip).toContainText('1 predecessor')
  await expect(tip).toContainText('1 successor')
  await page.mouse.move(x, y + 300)
  await expect(tip).toHaveCount(0)
})
