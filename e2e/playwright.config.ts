import { defineConfig, devices } from '@playwright/test'

const CI = !!process.env.CI

// Runs against the built app (docker compose up --build -d), never against
// real ClickUp: every /clickup/** request is mocked or aborted (see fixtures).
export default defineConfig({
  testDir: './tests',
  // *.e2e.ts, so the app's vitest run (default *.spec.ts / *.test.ts) never picks them up
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // a stray test.only fails CI instead of silently skipping the rest
  forbidOnly: CI,
  workers: Number(process.env.E2E_WORKERS) || 3,
  // no retries: they would hide flaky specs
  retries: 0,
  reporter: CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    timezoneId: 'Europe/Warsaw',
    locale: 'en-GB',
    viewport: { width: 1440, height: 900 },
    trace: CI ? 'retain-on-failure' : 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
