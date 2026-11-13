import { test, expect, rowDates, dragBy, center, clickBar, savedTasks, type SeedTask } from './fixtures'

const TASKS: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'B', name: 'Beta', start: '2026-03-09', end: '2026-03-13', dependencies: ['A'] },
  { id: 'D', name: 'Delta', start: '2026-03-04', end: '2026-03-10' },
  // Shared successor of A (through B) and D
  { id: 'X', name: 'Shared', start: '2026-03-16', end: '2026-03-18', dependencies: ['B', 'D'] },
  { id: 'N', name: 'No dates' },
  { id: 'U', name: 'Untouched', start: '2026-03-04', end: '2026-03-05' },
]
const DAY = 20

test('dragging a bar of a multi-selection moves the whole selection once, with successors', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await clickBar(page, 'A')
  await clickBar(page, 'D', { modifiers: ['Control'] })
  await page.locator('.task-row', { hasText: 'No dates' }).click({ position: { x: 80, y: 24 }, modifiers: ['Control'] })
  const { x, y } = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await dragBy(page, x, y, 3 * DAY)
  await expect.poll(() => rowDates(page, 'Alpha')).toEqual(['05.03.2026', '09.03.2026'])
  expect(await rowDates(page, 'Delta')).toEqual(['07.03.2026', '13.03.2026'])
  expect(await rowDates(page, 'Beta')).toEqual(['12.03.2026', '16.03.2026'])
  // Successor of both: moved once, not twice
  expect(await rowDates(page, 'Shared')).toEqual(['19.03.2026', '21.03.2026'])
  expect(await rowDates(page, 'Untouched')).toEqual(['04.03.2026', '05.03.2026'])
  const n = (await savedTasks(page)).find(t => t.id === 'N')!
  expect([n.start, n.end]).toEqual([undefined, undefined])
  // The drop keeps the selection and is one undo step
  await expect(page.locator('.task-row--selected')).toHaveCount(3)
  await page.keyboard.press('Control+z')
  await expect.poll(() => rowDates(page, 'Alpha')).toEqual(['02.03.2026', '06.03.2026'])
  expect(await rowDates(page, 'Delta')).toEqual(['04.03.2026', '10.03.2026'])
  expect(await rowDates(page, 'Shared')).toEqual(['16.03.2026', '18.03.2026'])
})

test('a bar outside the selection drags alone; resizing stays single', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await clickBar(page, 'A')
  await clickBar(page, 'D', { modifiers: ['Control'] })
  const u = await center(page, '.bar-wrapper[data-id="U"] .bar')
  await dragBy(page, u.x, u.y, 2 * DAY)
  await expect.poll(() => rowDates(page, 'Untouched')).toEqual(['06.03.2026', '07.03.2026'])
  expect(await rowDates(page, 'Alpha')).toEqual(['02.03.2026', '06.03.2026'])

  await clickBar(page, 'A')
  await clickBar(page, 'D', { modifiers: ['Control'] })
  const a = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await page.mouse.move(a.x, a.y)
  const h = (await page.locator('.bar-wrapper[data-id="A"] .handle.right').boundingBox())!
  await dragBy(page, h.x + h.width / 2, h.y + h.height / 2, 2 * DAY)
  await expect.poll(() => rowDates(page, 'Alpha')).toEqual(['02.03.2026', '08.03.2026'])
  expect(await rowDates(page, 'Delta')).toEqual(['04.03.2026', '10.03.2026'])
})
