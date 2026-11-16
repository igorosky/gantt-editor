import { test, expect, bar, row, dragBy, center, clickBar, type SeedTask } from './fixtures'
import type { Locator, Page } from '@playwright/test'

const people = [
  { id: 101, username: 'Alice Smith' },
  { id: 102, username: 'Bob Jones' },
  { id: 103, username: 'Carol White' },
]
const TASKS: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06', assignees: people },
  { id: 'B', name: 'Beta', start: '2026-03-09', end: '2026-03-13', assignees: [{ id: -1, username: 'Legacy Person' }] },
  { id: 'C', name: 'Gamma', start: '2026-03-16', end: '2026-03-20' },
]

const loadedImg = async (l: Locator) => l.evaluateAll(els => els.filter(e => (e as HTMLImageElement).naturalWidth > 0).length)

// A list wide enough for names, dates and faces (the default 30% of 1440 px
// is 430 px, where the row stack is left out on purpose)
const WIDE = { 'gantt-layout': { leftPct: 45, leftHidden: false } }

test('the row avatar stack shows only when the task list has room', async ({ page, seed }) => {
  await seed({ tasks: TASKS, linked: true })
  await expect(row(page, 'Alpha').locator('.task-row__people')).toBeHidden()
  const divider = (await page.locator('.divider').boundingBox())!
  await page.mouse.move(divider.x + 2, divider.y + 120)
  await page.mouse.down()
  await page.mouse.move(divider.x + 200, divider.y + 120, { steps: 6 })
  await page.mouse.up()
  await expect(row(page, 'Alpha').locator('.task-row__people')).toBeVisible()
})

test('rows, bars, tooltip and popup show profile pictures, initials otherwise', async ({ page, seed }) => {
  await seed({ tasks: TASKS, linked: true, storage: WIDE })
  const stack = row(page, 'Alpha').locator('.task-row__people .avatar')
  await expect(stack).toHaveCount(3)
  await expect(stack.first()).toBeVisible()
  await expect.poll(() => loadedImg(row(page, 'Alpha').locator('.task-row__people img'))).toBe(1)
  await expect(stack.nth(1)).toHaveText('BJ') // broken picture -> initials
  await expect(stack.nth(2)).toHaveText('CW') // no picture
  await expect(row(page, 'Beta').locator('.task-row__people .avatar')).toHaveText('LP')
  await expect(row(page, 'Gamma').locator('.task-row__people')).toHaveCount(0)

  // Bars: three avatars, Alice's picture kept, Bob's removed after the 404
  await expect(bar(page, 'A').locator('.bar-avatar')).toHaveCount(3)
  await expect(bar(page, 'A').locator('.bar-avatar image')).toHaveCount(1)
  await expect(bar(page, 'A').locator('.bar-avatar__text').first()).toHaveText('AS')

  const { x, y } = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await page.mouse.move(x, y)
  await expect(page.getByRole('tooltip').locator('.avatar img')).toHaveCount(1)

  await clickBar(page, 'A', { clickCount: 2 })
  await expect.poll(() => loadedImg(page.locator('.tdp-assignee-chip img'))).toBe(1)
})

test('bar avatars ride along with a drag', async ({ page, seed }) => {
  await seed({ tasks: TASKS, linked: true })
  const pos = () => bar(page, 'A').locator('.bar-avatars').evaluate(g => g.getBoundingClientRect().x)
  const before = await pos()
  const { x, y } = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await dragBy(page, x, y, 60)
  await expect.poll(pos).toBeGreaterThan(before + 40)
})

async function setPictures(page: Page, labels: string[], on: boolean) {
  await page.getByRole('button', { name: 'Settings' }).click()
  for (const l of labels) await page.getByLabel(l).setChecked(on)
  await page.getByRole('button', { name: 'Save' }).click()
}

test('settings switch the new places off one by one', async ({ page, seed }) => {
  await seed({ tasks: TASKS, linked: true, storage: WIDE })
  await expect(bar(page, 'A').locator('.bar-avatar')).toHaveCount(3)
  await setPictures(page, ['In the task list', 'Next to gantt bars', 'In the bar tooltip'], false)
  await expect(row(page, 'Alpha').locator('.task-row__people')).toHaveCount(0)
  await expect(bar(page, 'A').locator('.bar-avatar')).toHaveCount(0)
  const { x, y } = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await page.mouse.move(x, y)
  const tip = page.getByRole('tooltip')
  await expect(tip).toContainText('Alice Smith')
  await expect(tip.locator('.avatar')).toHaveCount(0)
  await page.mouse.move(x, y + 300)
  await setPictures(page, ['Next to gantt bars'], true)
  await expect(bar(page, 'A').locator('.bar-avatar')).toHaveCount(3)
})

test('the portfolio People tab shows pictures unless turned off', async ({ page, seed }) => {
  await seed({ tasks: TASKS, linked: true })
  await page.getByRole('button', { name: 'Portfolio' }).click()
  await page.getByRole('tab', { name: /People/ }).or(page.getByRole('button', { name: 'People' })).first().click()
  const alice = page.locator('.pf-heat__name', { hasText: 'Alice Smith' })
  await expect.poll(() => loadedImg(alice.locator('img'))).toBe(1)
  await expect(page.locator('.pf-heat__name', { hasText: 'Bob Jones' }).locator('.pf-avatar')).toHaveText('BJ')
  await setPictures(page, ['In the portfolio (People, Workload)'], false)
  await expect(alice.locator('img')).toHaveCount(0)
  await expect(alice.locator('.pf-avatar')).toHaveText('AS')
})

test('a local board without ClickUp shows initials', async ({ page, seed }) => {
  await seed({ tasks: TASKS, storage: WIDE })
  await expect(row(page, 'Alpha').locator('.task-row__people .avatar').first()).toHaveText('AS')
  await expect(row(page, 'Alpha').locator('.task-row__people img')).toHaveCount(0)
  await expect(bar(page, 'A').locator('.bar-avatar image')).toHaveCount(0)
})
