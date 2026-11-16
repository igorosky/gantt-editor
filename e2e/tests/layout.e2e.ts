import { test, expect, row, type SeedTask } from './fixtures'

const many: SeedTask[] = Array.from({ length: 40 }, (_, i) => ({
  id: `T${i}`, name: `Task ${i}`, start: '2026-03-02', end: '2026-03-06',
}))

test('the task list hides and comes back aligned with the chart', async ({ page, seed }) => {
  await seed({ tasks: many })
  const left = page.locator('.app__panel--left')
  await page.getByRole('button', { name: 'Hide the task list' }).click()
  await expect(left).toHaveClass(/app__panel--hidden/)
  await expect(left).toBeHidden()
  await expect(page.locator('.divider')).toHaveCount(0)
  const gantt = page.locator('.gantt-container')
  expect((await gantt.boundingBox())!.width).toBeGreaterThan(1300)

  await gantt.evaluate(el => { el.scrollTop = 480 })
  await page.getByRole('button', { name: '☰ Tasks' }).click()
  await expect(left).toBeVisible()
  await expect.poll(() => page.locator('.task-panel__list').evaluate(el => el.scrollTop)).toBe(480)
  await page.locator('.task-panel__list').evaluate(el => { el.scrollTop = 96 })
  await expect.poll(() => gantt.evaluate(el => el.scrollTop)).toBe(96)
})

test('backslash toggles the list; the choice survives a reload', async ({ page, seed }) => {
  await seed({ tasks: many.slice(0, 3) })
  await page.locator('.gantt-container').click({ position: { x: 10, y: 400 } })
  await page.keyboard.press('\\')
  await expect(page.locator('.app__panel--left')).toBeHidden()
  await page.reload()
  await expect(page.locator('.app__panel--left')).toBeHidden()
  await page.locator('.gantt-container').click({ position: { x: 10, y: 400 } })
  await page.keyboard.press('\\')
  await expect(page.locator('.app__panel--left')).toBeVisible()
})

test('with the list hidden, Add task and the filter chip live in the toolbar', async ({ page, seed }) => {
  await seed({ tasks: many.slice(0, 5) })
  await page.locator('.fbar-add__btn').click()
  await page.getByText('Name contains').click()
  await page.locator('.fbar-chip__main').click()
  await page.getByPlaceholder('Match in task name…').fill('Task 3')
  await expect(page.locator('.task-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Hide the task list' }).click()
  const chip = page.locator('.gantt-panel__filter-chip')
  await expect(chip).toContainText('Filtered: 1 of 5')
  await chip.getByRole('button', { name: 'Clear filters' }).click()
  await expect(chip).toHaveCount(0)
  await expect(page.locator('.bar-wrapper')).toHaveCount(5)

  await page.locator('.gantt-panel__topbar').getByRole('button', { name: '+ Add task' }).click()
  await page.locator('.tdp-title').fill('From toolbar')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.locator('.bar-wrapper')).toHaveCount(6)
  await page.getByRole('button', { name: '☰ Tasks' }).click()
  await expect(row(page, 'From toolbar')).toHaveCount(1)
})

test('the divider position persists', async ({ page, seed }) => {
  await seed({ tasks: many.slice(0, 3) })
  const divider = page.locator('.divider')
  const box = (await divider.boundingBox())!
  await page.mouse.move(box.x + 2, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x + 152, box.y + 200, { steps: 5 })
  await page.mouse.up()
  const width = (await page.locator('.app__panel--left').boundingBox())!.width
  await page.reload()
  const after = (await page.locator('.app__panel--left').boundingBox())!.width
  expect(Math.abs(after - width)).toBeLessThan(2)
})

test('the chart opens at today even when ClickUp data arrives just after load', async ({ page, seed, clickup }) => {
  clickup.on(async (route, url) => {
    if (url.pathname !== '/clickup/team') return false
    await new Promise(r => setTimeout(r, 400))
    return false // then the default /team answer
  })
  await seed({ tasks: [...many.slice(0, 3), { id: 'L', name: 'Later', start: '2026-06-01', end: '2026-06-05' }], linked: true })
  await page.waitForTimeout(800)
  const c = (await page.locator('.gantt-container').boundingBox())!
  const line = (await page.locator('.current-highlight').first().boundingBox())!
  expect(line.x).toBeGreaterThan(c.x)
  expect(line.x).toBeLessThan(c.x + 120)
})
