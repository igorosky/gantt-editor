// Behaviour that existed before the interactive-board work and must survive it
import { test, expect, bar, row, rowDates, savedTasks, dragBy, center, clickBar, type SeedTask } from './fixtures'

const BASE: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'B', name: 'Beta', start: '2026-03-09', end: '2026-03-13', dependencies: ['A'] },
  { id: 'P', name: 'Parent', start: '2026-03-02', end: '2026-03-13' },
  { id: 'S', name: 'Sub', start: '2026-03-03', end: '2026-03-05', parentId: 'P' },
  { id: 'C', name: 'Gamma', start: '2026-03-16', end: '2026-03-20' },
  { id: 'M', name: 'Mile', start: '2026-03-20', end: '2026-03-20', type: 'milestone' },
]

// Week view: 140 px per 7-day column
const DAY = 20

test('dragging a bar moves its successors, not unrelated tasks', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  const { x, y } = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await dragBy(page, x, y, 7 * DAY)
  await expect.poll(() => rowDates(page, 'Alpha')).toEqual(['09.03.2026', '13.03.2026'])
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['16.03.2026', '20.03.2026'])
  expect(await rowDates(page, 'Sub')).toEqual(['03.03.2026', '05.03.2026'])
  expect(await rowDates(page, 'Gamma')).toEqual(['16.03.2026', '20.03.2026'])
})

test('dragging a parent moves its subtasks', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  const { x, y } = await center(page, '.bar-wrapper[data-id="P"] .bar')
  await dragBy(page, x, y, 2 * DAY)
  await expect.poll(() => rowDates(page, 'Parent')).toEqual(['04.03.2026', '15.03.2026'])
  await expect.poll(() => rowDates(page, 'Sub')).toEqual(['05.03.2026', '07.03.2026'])
})

test('right-edge resize moves successors only by the end delta', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  const { x, y } = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await page.mouse.move(x, y)
  const box = (await page.locator('.bar-wrapper[data-id="A"] .handle.right').boundingBox())!
  await dragBy(page, box.x + box.width / 2, box.y + box.height / 2, 2 * DAY)
  await expect.poll(() => rowDates(page, 'Alpha')).toEqual(['02.03.2026', '08.03.2026'])
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['11.03.2026', '15.03.2026'])
})

test('connect mode adds and removes a dependency arrow', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  const arrow = page.locator('path[data-from="A"][data-to="C"]')
  await expect(arrow).toHaveCount(0)
  for (const expected of [1, 0]) {
    await page.getByRole('button', { name: /Connect tasks/ }).click()
    await clickBar(page, 'A')
    await clickBar(page, 'C')
    await expect(arrow).toHaveCount(expected)
  }
  const c = (await savedTasks(page)).find(t => t.id === 'C')!
  expect(c.dependencies ?? []).toEqual([])
})

test('dropping a row onto another nests it', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  const from = (await row(page, 'Gamma').locator('.task-row__grip').boundingBox())!
  const to = (await row(page, 'Alpha').boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(to.x + 120, from.y + ((to.y + to.height / 2) - from.y) * (i / 10))
  }
  await page.mouse.up()
  await expect.poll(async () => (await savedTasks(page)).find(t => t.id === 'C')?.parentId).toBe('A')
})

test('rows stay aligned with bars while scrolling either panel', async ({ page, seed }) => {
  const many: SeedTask[] = Array.from({ length: 40 }, (_, i) => ({
    id: `T${i}`, name: `Task ${i}`, start: '2026-03-02', end: '2026-03-06',
  }))
  await seed({ tasks: many })
  await page.locator('.gantt-container').evaluate(el => { el.scrollTop = 500 })
  await expect.poll(() => page.locator('.task-panel__list').evaluate(el => el.scrollTop)).toBe(500)
  await page.locator('.task-panel__list').evaluate(el => { el.scrollTop = 300 })
  await expect.poll(() => page.locator('.gantt-container').evaluate(el => el.scrollTop)).toBe(300)
})

test('an untouched new task closes at once, an edited one asks first', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  await page.getByRole('button', { name: '+ Add task' }).first().click()
  await expect(page.locator('.tdp-modal')).toBeVisible()
  await page.locator('.tdp-iconbtn--close').click()
  await expect(page.locator('.tdp-modal')).toHaveCount(0)

  await page.getByRole('button', { name: '+ Add task' }).first().click()
  await page.locator('.tdp-title').fill('Something new')
  await page.locator('.tdp-iconbtn--close').click()
  await expect(page.locator('.tdp-confirm')).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.locator('.tdp-modal')).toHaveCount(0)
  expect((await savedTasks(page)).length).toBe(BASE.length)
})

test('creating a task adds it to both panels', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  await page.getByRole('button', { name: '+ Add task' }).first().click()
  await page.locator('.tdp-title').fill('Brand new')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(row(page, 'Brand new')).toHaveCount(1)
  const t = (await savedTasks(page)).find(x => x.name === 'Brand new')!
  await expect(bar(page, t.id)).toHaveCount(1)
})

test('critical path marks the dependency chain', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  await page.getByRole('button', { name: /Critical path/ }).click()
  await expect(bar(page, 'A')).toHaveClass(/critical/)
  await expect(bar(page, 'B')).toHaveClass(/critical/)
  await expect(bar(page, 'C')).not.toHaveClass(/critical/)
  await expect(page.locator('path[data-from="A"][data-to="B"]')).toHaveClass(/arrow--critical/)
  await expect(row(page, 'Alpha')).toHaveClass(/task-row--critical/)
})

test('editing a date in the left panel shifts successors', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  const due = row(page, 'Alpha').locator('input[title^="Due date"]')
  await due.fill('09.03.2026')
  await due.press('Enter')
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['12.03.2026', '16.03.2026'])
})

test('collapsing a parent hides its subtask in both panels', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  await expect(row(page, 'Sub')).toHaveCount(1)
  await row(page, 'Parent').locator('.task-row__toggle').click()
  await expect(row(page, 'Sub')).toHaveCount(0)
  await expect(bar(page, 'S')).toHaveCount(0)
  const rows = await page.locator('.task-row').count()
  const bars = await page.locator('.bar-wrapper').count()
  expect(bars).toBe(rows)
})

test('milestone renders as a diamond and drags by whole days', async ({ page, seed }) => {
  await seed({ tasks: BASE })
  await expect(bar(page, 'M')).toHaveClass(/milestone/)
  const { x, y } = await center(page, '.bar-wrapper[data-id="M"] .bar')
  await dragBy(page, x, y, 3 * DAY)
  await expect.poll(() => rowDates(page, 'Mile')).toEqual(['23.03.2026'])
})
