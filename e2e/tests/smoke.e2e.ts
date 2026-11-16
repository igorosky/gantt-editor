// Areas the interactive-board work touched only indirectly: they must still
// open and render without page errors (the fixture fails on any)
import { test, expect, type SeedTask } from './fixtures'

const TASKS: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06', assignees: [{ id: 101, username: 'Alice Smith' }] },
  { id: 'B', name: 'Beta', start: '2026-03-09', end: '2026-03-13', dependencies: ['A'], assignees: [{ id: 102, username: 'Bob Jones' }] },
  { id: 'M', name: 'Mile', start: '2026-03-20', end: '2026-03-20', type: 'milestone', dependencies: ['B'] },
]

test('export dialog renders its preview', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await page.getByRole('button', { name: 'Export' }).click()
  await expect(page.locator('.exp-preview svg, .exp-preview img').first()).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
})

test('every portfolio tab renders', async ({ page, seed }) => {
  await seed({ tasks: TASKS, linked: true })
  await page.getByRole('button', { name: 'Portfolio' }).click()
  const tabs = page.getByRole('navigation', { name: 'Portfolio views' }).getByRole('button')
  const n = await tabs.count()
  expect(n).toBeGreaterThanOrEqual(5)
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click()
    await page.waitForTimeout(150)
  }
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Board' }).click()
  await expect(page.locator('.bar-wrapper[data-id="A"]')).toHaveCount(1)
})

test('settings dialog opens, saves and resets', async ({ page, seed }) => {
  await seed({ tasks: TASKS })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Reset to defaults' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)
})
