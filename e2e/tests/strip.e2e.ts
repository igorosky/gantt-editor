import { test, expect, type SeedTask } from './fixtures'
import type { Page } from '@playwright/test'

const TASKS: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'B', name: 'Beta', start: '2026-03-04', end: '2026-03-12' },
]

async function stripMatchesColumns(page: Page) {
  // One bar slot per gantt column, aligned with the chart's left edge
  const c = (await page.locator('.gantt-container').boundingBox())!
  const plot = (await page.locator('.load-strip__plot').boundingBox())!
  expect(Math.abs(plot.x - c.x)).toBeLessThan(2)
}

test('the workload strip follows the zoom', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await page.getByRole('button', { name: /Workload/ }).click()
  const meta = page.locator('.load-strip__meta')
  await expect(meta).toContainText('Tasks running per week')
  await stripMatchesColumns(page)
  await page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: 'Day' }).click()
  await expect(meta).toContainText('Tasks running per day')
  await stripMatchesColumns(page)
  await page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: 'Month' }).click()
  await expect(meta).toContainText('Tasks running per month')
  await stripMatchesColumns(page)
})

test('with the task list hidden the strip keeps its controls and stays aligned', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await page.getByRole('button', { name: /Workload/ }).click()
  await page.keyboard.press('\\')
  await expect(page.locator('.app__panel--left')).toBeHidden()
  await expect(page.locator('.load-strip__lhs')).toHaveClass(/load-strip__lhs--overlay/)
  await expect(page.getByRole('group', { name: 'Workload metric' }).or(page.locator('.load-strip__lhs').getByRole('button', { name: 'Est. hours' })).first()).toBeVisible()
  await stripMatchesColumns(page)
  await page.locator('.load-strip__lhs').getByRole('button', { name: 'Hide workload' }).click()
  await expect(page.locator('.load-strip')).toHaveCount(0)
})
