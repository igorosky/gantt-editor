import { test, expect, bar, row, savedTasks, center, clickBar, type SeedTask } from './fixtures'
import type { Page } from '@playwright/test'

const TREE: SeedTask[] = [
  { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
  { id: 'P', name: 'Parent', start: '2026-03-02', end: '2026-03-13' },
  { id: 'S', name: 'Sub task', start: '2026-03-03', end: '2026-03-05', parentId: 'P' },
  { id: 'C', name: 'Gamma', start: '2026-03-16', end: '2026-03-20' },
]

const selected = (page: Page) => page.locator('.task-row--selected .task-row__name-text').allInnerTexts()

async function focusBoard(page: Page) {
  await page.locator('.gantt-container').click({ position: { x: 10, y: 600 } })
}

test('arrow keys move and grow the selection, and keep it in view', async ({ page, seed }) => {
  await seed({ tasks: Array.from({ length: 40 }, (_, i) => ({ id: `T${i}`, name: `Task ${i}`, start: '2026-03-02', end: '2026-03-06' })) })
  await focusBoard(page)
  await page.keyboard.press('ArrowDown')
  expect(await selected(page)).toEqual(['Task 0'])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  expect(await selected(page)).toEqual(['Task 1', 'Task 2', 'Task 3'])
  await page.keyboard.press('ArrowUp')
  expect(await selected(page)).toEqual(['Task 2'])
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowDown')
  expect(await selected(page)).toEqual(['Task 27'])
  await expect(row(page, 'Task 27')).toBeInViewport()
  const list = await page.locator('.task-panel__list').evaluate(el => el.scrollTop)
  expect(list).toBeGreaterThan(0)
  await expect.poll(() => page.locator('.gantt-container').evaluate(el => el.scrollTop)).toBe(list)
})

test('left / right collapse, expand and walk the hierarchy', async ({ page, seed }) => {
  await seed({ tasks: TREE })
  await row(page, 'Parent').click({ position: { x: 90, y: 24 } })
  await page.keyboard.press('ArrowLeft')
  await expect(row(page, 'Sub task')).toHaveCount(0)
  await page.keyboard.press('ArrowRight')
  await expect(row(page, 'Sub task')).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  expect(await selected(page)).toEqual(['Sub task'])
  await page.keyboard.press('ArrowLeft')
  expect(await selected(page)).toEqual(['Parent'])
})

test('quick find jumps to a task inside a collapsed parent and flashes it', async ({ page, seed }) => {
  await seed({ tasks: TREE })
  await row(page, 'Parent').locator('.task-row__toggle').click()
  await expect(row(page, 'Sub task')).toHaveCount(0)
  await focusBoard(page)
  await page.keyboard.press('Control+k')
  const find = page.getByRole('dialog', { name: 'Find a task' })
  await find.getByRole('combobox').fill('sbtsk')
  await expect(find.getByRole('option').first()).toContainText('in a collapsed task')
  await page.keyboard.press('Enter')
  await expect(find).toHaveCount(0)
  await expect(row(page, 'Sub task')).toHaveClass(/task-row--selected/)
  await expect(row(page, 'Sub task')).toHaveClass(/is-flash/)
  await expect(bar(page, 'S')).toHaveClass(/is-selected/)
})

test('quick find clears filters for a filtered-out task; / opens it too', async ({ page, seed }) => {
  await seed({ tasks: TREE })
  await page.locator('.fbar-add__btn').click()
  await page.getByText('Name contains').click()
  await page.locator('.fbar-chip__main').click()
  await page.getByPlaceholder('Match in task name…').fill('Alpha')
  await expect(page.locator('.task-row')).toHaveCount(1)
  await focusBoard(page)
  await page.keyboard.press('/')
  const find = page.getByRole('dialog', { name: 'Find a task' })
  await find.getByRole('combobox').fill('gamma')
  await expect(find.getByRole('option').first()).toContainText('filtered out')
  await page.keyboard.press('Enter')
  await expect(row(page, 'Gamma')).toHaveClass(/task-row--selected/)
  await expect(page.locator('.fbar-chip')).toHaveCount(0)
})

test('quick find opens a backlog task the board hides in its details', async ({ page, seed }) => {
  await seed({
    tasks: [...TREE, { id: 'K', name: 'Kept for later', status: 'backlog' }],
    storage: { 'gantt-settings': { backlog: { statuses: ['backlog'], include: { board: false, warnings: true, health: true, workload: true } } } },
  })
  await expect(row(page, 'Kept for later')).toHaveCount(0)
  await focusBoard(page)
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox').fill('kept')
  await expect(page.getByRole('option').first()).toContainText('backlog (hidden)')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Task details: Kept for later' })).toBeVisible()
})

test('? shows the shortcuts; Escape closes them', async ({ page, seed }) => {
  await seed({ tasks: TREE })
  await focusBoard(page)
  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(help).toContainText('Ctrl / Cmd + K')
  await page.keyboard.press('Escape')
  await expect(help).toHaveCount(0)
})

test('a created task is selected and flashed', async ({ page, seed }) => {
  await seed({ tasks: TREE })
  await page.getByRole('button', { name: '+ Add task' }).first().click()
  await page.locator('.tdp-title').fill('Brand new')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(row(page, 'Brand new')).toHaveClass(/task-row--selected/)
  await expect(row(page, 'Brand new')).toHaveClass(/is-flash/)
})

async function dragDot(page: Page, from: string, to: string) {
  const { x, y } = await center(page, `.bar-wrapper[data-id="${from}"] .bar`)
  await page.mouse.move(x, y)
  const dot = (await page.locator(`.bar-wrapper[data-id="${from}"] .connect-handle`).boundingBox())!
  const target = await center(page, `.bar-wrapper[data-id="${to}"] .bar`)
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 12 })
  await expect(bar(page, to)).toHaveClass(/connect-target/)
  await page.mouse.up()
}

test('dragging the dot after a bar onto another links them; one undo step', async ({ page, seed }) => {
  await seed({ tasks: TREE })
  await dragDot(page, 'A', 'C')
  await expect.poll(async () => (await savedTasks(page)).find(t => t.id === 'C')?.dependencies).toEqual(['A'])
  await expect(page.locator('path[data-from="A"][data-to="C"]')).toHaveCount(1)
  // The bar itself did not move
  expect((await savedTasks(page)).find(t => t.id === 'A')?.start).toBe('2026-03-01T23:00:00.000Z')
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await savedTasks(page)).find(t => t.id === 'C')?.dependencies ?? []).toEqual([])
})

test('a drag link that would loop is refused; Escape cancels a drag', async ({ page, seed }) => {
  await seed({ tasks: [
    { id: 'A', name: 'Alpha', start: '2026-03-02', end: '2026-03-06' },
    { id: 'C', name: 'Gamma', start: '2026-03-16', end: '2026-03-20', dependencies: ['A'] },
  ] })
  await dragDot(page, 'C', 'A')
  await expect(page.locator('.toast')).toContainText('Would create a loop')
  expect((await savedTasks(page)).find(t => t.id === 'A')?.dependencies ?? []).toEqual([])

  await clickBar(page, 'A')
  const { x, y } = await center(page, '.bar-wrapper[data-id="A"] .bar')
  await page.mouse.move(x, y)
  const dot = (await page.locator('.bar-wrapper[data-id="A"] .connect-handle').boundingBox())!
  await page.mouse.move(dot.x + 4, dot.y + 4)
  await page.mouse.down()
  await page.mouse.move(dot.x + 200, dot.y + 60, { steps: 5 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.locator('.connect-line')).toHaveCount(0)
  // Escape went to the drag, not to the selection
  await expect(bar(page, 'A')).toHaveClass(/is-selected/)
})
