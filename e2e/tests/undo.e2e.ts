import { test, expect, row, rowDates, savedTasks, dragBy, center, LIST_ID, type SeedTask } from './fixtures'

const TASKS: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'B', name: 'Beta', start: '2026-03-09', end: '2026-03-13', dependencies: ['A'] },
  { id: 'C', name: 'Gamma', start: '2026-03-16', end: '2026-03-20' },
]
const DAY = 20
const undoBtn = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Undo', exact: true })
const redoBtn = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Redo', exact: true })

test('a drag is one undo step, successors included; Ctrl+Y redoes it', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await expect(undoBtn(page)).toBeDisabled()
  const { x, y } = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await dragBy(page, x, y, 7 * DAY)
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['16.03.2026', '20.03.2026'])
  await expect(undoBtn(page)).toBeEnabled()
  await expect(undoBtn(page)).toHaveAttribute('title', /Undo: Change dates of "Alpha"/)

  await page.keyboard.press('Control+z')
  await expect.poll(() => rowDates(page, 'Alpha')).toEqual(['02.03.2026', '06.03.2026'])
  expect(await rowDates(page, 'Beta')).toEqual(['09.03.2026', '13.03.2026'])
  await expect(page.locator('.toast')).toContainText('Undone: Change dates of "Alpha"')
  await expect(undoBtn(page)).toBeDisabled()

  await page.keyboard.press('Control+y')
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['16.03.2026', '20.03.2026'])
  expect(await rowDates(page, 'Alpha')).toEqual(['09.03.2026', '13.03.2026'])
})

test('undo brings back a deleted task, toolbar buttons work', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await row(page, 'Gamma').hover()
  await row(page, 'Gamma').getByRole('button', { name: /More actions/ }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(row(page, 'Gamma')).toHaveCount(0)
  await undoBtn(page).click()
  await expect(row(page, 'Gamma')).toHaveCount(1)
  expect((await savedTasks(page)).map(t => t.id)).toEqual(['A', 'B', 'C'])
  await redoBtn(page).click()
  await expect(row(page, 'Gamma')).toHaveCount(0)
})

test('an unchanged blur records nothing; a left-panel date edit undoes with its successors', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  const due = row(page, 'Alpha').locator('input[title^="Due date"]')
  await due.click()
  await due.press('Enter') // same value: no step
  await expect(undoBtn(page)).toBeDisabled()
  await due.fill('09.03.2026')
  await due.press('Enter')
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['12.03.2026', '16.03.2026'])
  await page.locator('.gantt-container').click({ position: { x: 5, y: 300 } }) // focus out of the field
  await page.keyboard.press('Control+z')
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['09.03.2026', '13.03.2026'])
  expect(await rowDates(page, 'Alpha')).toEqual(['02.03.2026', '06.03.2026'])
})

test('Ctrl+Z inside a text field is left to the field', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  const { x, y } = await center(page, '.bar-wrapper[data-id="C"] .bar')
  await dragBy(page, x, y, 2 * DAY)
  await expect.poll(() => rowDates(page, 'Gamma')).toEqual(['18.03.2026', '22.03.2026'])
  const due = row(page, 'Alpha').locator('input[title^="Due date"]')
  await due.click()
  await page.keyboard.press('Control+z')
  expect(await rowDates(page, 'Gamma')).toEqual(['18.03.2026', '22.03.2026'])
})

test('a pull empties the undo history', async ({ page, seed, clickup }) => {
  clickup.remoteTasks = []
  await seed({ tasks: TASKS, linked: true })
  const { x, y } = await center(page, '.bar-wrapper[data-id="C"] .bar')
  await dragBy(page, x, y, 2 * DAY)
  await expect(undoBtn(page)).toBeEnabled()
  await page.getByRole('button', { name: '↓ Pull' }).click()
  await expect(page.locator('.app__sync-report')).toBeVisible()
  await expect(undoBtn(page)).toBeDisabled()
  expect(clickup.calls.some(c => c.path === `/list/${LIST_ID}/task`)).toBe(true)
})
