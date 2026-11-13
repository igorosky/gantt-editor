// Fixes from the branch review
import { test, expect, bar, row, rowDates, dragBy, center, clickBar, savedTasks, type SeedTask } from './fixtures'

const TASKS: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'B', name: 'Beta', start: '2026-03-09', end: '2026-03-13' },
]
const DAY = 20

test('drags before and after a visit to the portfolio are separate undo steps', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  let c = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await dragBy(page, c.x, c.y, 2 * DAY)
  await expect.poll(() => rowDates(page, 'Alpha')).toEqual(['04.03.2026', '08.03.2026'])
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Portfolio' }).click()
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Board' }).click()
  await page.locator('.bar-wrapper[data-id="B"]').waitFor()
  c = await center(page, '.bar-wrapper[data-id="B"] .bar')
  await dragBy(page, c.x, c.y, 2 * DAY)
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['11.03.2026', '15.03.2026'])
  await page.keyboard.press('Control+z')
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['09.03.2026', '13.03.2026'])
  expect(await rowDates(page, 'Alpha')).toEqual(['04.03.2026', '08.03.2026'])
})

test('a details popup opened by F2 with the list hidden does not reopen an old picker', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await row(page, 'Alpha').click({ button: 'right', position: { x: 80, y: 24 } })
  await page.locator('.ctx-menu__item', { hasText: 'Add predecessor…' }).click()
  await expect(page.getByRole('dialog', { name: 'Add predecessor' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('.tdp-iconbtn--close').click()
  await page.keyboard.press('\\')
  await clickBar(page, 'B')
  await page.keyboard.press('F2')
  await expect(page.getByRole('dialog', { name: 'Task details: Beta' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Add predecessor' })).toHaveCount(0)
})

test('board shortcuts stay off while the board switcher is open', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await clickBar(page, 'A')
  await page.getByRole('button', { name: /E2E board/ }).click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Escape')
  expect((await savedTasks(page)).map(t => t.id)).toEqual(['A', 'B'])
  await expect(bar(page, 'A')).toHaveClass(/is-selected/)
})

test('a click on a just-dropped bar selects it', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  const c = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await dragBy(page, c.x, c.y, 2 * DAY)
  await page.waitForTimeout(450)
  await clickBar(page, 'A')
  await expect(bar(page, 'A')).toHaveClass(/is-selected/)
})

test('after clearing every task the chart comes back and drags work', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.locator('.bar-wrapper')).toHaveCount(0)
  await page.getByRole('button', { name: '+ Add task' }).first().click()
  await page.getByRole('button', { name: 'Create task' }).click()
  const id = (await savedTasks(page))[0].id
  const before = await rowDates(page, 'New task')
  const c = await center(page, `.bar-wrapper[data-id="${id}"] .bar`)
  await dragBy(page, c.x, c.y, 2 * DAY)
  await expect.poll(() => rowDates(page, 'New task')).not.toEqual(before)
})
