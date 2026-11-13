import { test, expect, rowDates, dragBy, center, settle, revealBar, type SeedTask } from './fixtures'
import type { Page } from '@playwright/test'

const TASKS: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'B', name: 'Beta', start: '2026-03-09', end: '2026-03-13', dependencies: ['A'] },
  { id: 'M', name: 'Mile', start: '2026-03-12', end: '2026-03-12', type: 'milestone' },
]

async function zoom(page: Page, mode: 'Day' | 'Week' | 'Month') {
  await page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: mode }).click()
  await settle(page)
}

async function columnPx(page: Page): Promise<number> {
  return page.locator('.gantt-container').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--gv-column-width')))
}

test('Day view drags by whole days', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await zoom(page, 'Day')
  const day = await columnPx(page)
  await revealBar(page, 'A')
  const { x, y } = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await dragBy(page, x, y, 3 * day)
  await expect.poll(() => rowDates(page, 'Alpha')).toEqual(['05.03.2026', '09.03.2026'])
  await expect.poll(() => rowDates(page, 'Beta')).toEqual(['12.03.2026', '16.03.2026'])
})

test('Month view drag keeps the length in days and moves successors by the same days', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await zoom(page, 'Month')
  const month = await columnPx(page)
  const { x, y } = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await dragBy(page, x, y, Math.round((month * 10) / 31))
  await expect.poll(async () => (await rowDates(page, 'Alpha'))[0]).not.toBe('02.03.2026')
  const [s, e] = await rowDates(page, 'Alpha')
  const parse = (v: string) => { const [d, m, yy] = v.split('.').map(Number); return new Date(yy, m - 1, d) }
  const moved = Math.round((parse(s).getTime() - new Date(2026, 2, 2).getTime()) / 86400000)
  expect(moved).toBeGreaterThanOrEqual(8)
  expect(moved).toBeLessThanOrEqual(12)
  expect(Math.round((parse(e).getTime() - parse(s).getTime()) / 86400000)).toBe(4)
  const [bs, be] = await rowDates(page, 'Beta')
  expect(Math.round((parse(bs).getTime() - new Date(2026, 2, 9).getTime()) / 86400000)).toBe(moved)
  expect(Math.round((parse(be).getTime() - parse(bs).getTime()) / 86400000)).toBe(4)
})

test('Month view right-edge resize lands on a day, start unchanged', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await zoom(page, 'Month')
  const month = await columnPx(page)
  const { x, y } = await center(page, '.bar-wrapper[data-id="B"] .bar')
  await page.mouse.move(x, y)
  const h = (await page.locator('.bar-wrapper[data-id="B"] .handle.right').boundingBox())!
  await dragBy(page, h.x + h.width / 2, h.y + h.height / 2, Math.round((month * 5) / 31))
  await expect.poll(async () => (await rowDates(page, 'Beta'))[1]).not.toBe('13.03.2026')
  const [s, e] = await rowDates(page, 'Beta')
  expect(s).toBe('09.03.2026')
  const [d] = e.split('.').map(Number)
  expect(d).toBeGreaterThanOrEqual(16)
  expect(d).toBeLessThanOrEqual(20)
})

test('Month view milestone drag lands on a day', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await zoom(page, 'Month')
  const month = await columnPx(page)
  const { x, y } = await center(page, '.bar-wrapper[data-id="M"] .bar')
  await dragBy(page, x, y, Math.round((month * 6) / 31))
  await expect.poll(async () => (await rowDates(page, 'Mile'))[0]).not.toBe('12.03.2026')
  const [d] = (await rowDates(page, 'Mile'))[0].split('.').map(Number)
  expect(d).toBeGreaterThanOrEqual(16)
  expect(d).toBeLessThanOrEqual(20)
})

// The date (days after 2 March 2026) in the middle of the visible chart,
// measured from bar A (2-6 March, 5 days wide)
async function centreDay(page: Page): Promise<number> {
  const c = (await page.locator('.gantt-container').boundingBox())!
  const b = (await page.locator('.bar-wrapper[data-id="A"] .bar').boundingBox())!
  return (c.x + c.width / 2 - b.x) / (b.width / 5)
}

test('switching views keeps the date in the middle and persists; Today scrolls back', async ({ page, seed }) => {
  // A far task makes the chart wide enough to scroll A out of view
  await seed({ tasks: [...TASKS, { id: 'Z', name: 'Later', start: '2026-07-01', end: '2026-07-03' }] })
  const inView = async (id: string) => {
    const c = (await page.locator('.gantt-container').boundingBox())!
    const b = (await page.locator(`.bar-wrapper[data-id="${id}"] .bar`).boundingBox())!
    return b.x >= c.x && b.x + b.width <= c.x + c.width
  }
  const start = await centreDay(page)
  for (const mode of ['Month', 'Day', 'Week'] as const) {
    await zoom(page, mode)
    expect(Math.abs((await centreDay(page)) - start)).toBeLessThan(1.5)
  }
  await zoom(page, 'Month')
  await page.reload()
  await settle(page)
  await expect(page.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true')
  await zoom(page, 'Week')
  await page.locator('.gantt-container').evaluate(el => { el.scrollLeft = el.scrollWidth })
  expect(await inView('A')).toBe(false)
  await page.getByRole('button', { name: 'Today' }).click()
  await settle(page)
  expect(await inView('A')).toBe(true)
})

test('critical arrows keep their mark after a view change and a scroll extension', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await page.getByRole('button', { name: /Critical path/ }).click()
  const arrow = page.locator('path[data-from="A"][data-to="B"]')
  await expect(arrow).toHaveClass(/arrow--critical/)
  await zoom(page, 'Day')
  await expect(arrow).toHaveClass(/arrow--critical/)
  // Scroll left past the middle with the wheel: frappe extends the chart and re-renders
  const gantt = page.locator('.gantt-container')
  await gantt.evaluate(el => { el.scrollLeft = 10 })
  const before = await page.locator('.gantt .grid-header .lower-text, .gantt-container .lower-text').count()
  const box = (await gantt.boundingBox())!
  await page.mouse.move(box.x + 200, box.y + 200)
  await page.mouse.wheel(-200, 0)
  await expect.poll(() => page.locator('.gantt .grid-header .lower-text, .gantt-container .lower-text').count()).toBeGreaterThan(before)
  await expect(arrow).toHaveClass(/arrow--critical/)
})
