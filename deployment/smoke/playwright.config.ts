import { defineConfig, devices } from '@playwright/test'

// Usage: SMOKE_BASE_URL=http://localhost:8088 npx playwright test
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:8088',
    trace: 'retain-on-failure',
    screenshot: 'on',
    // CI keeps a video of every run as proof the deployed UI works; slowMo makes it watchable.
    video: process.env.CI ? { mode: 'on', size: { width: 1280, height: 800 } } : 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
    launchOptions: { slowMo: process.env.CI ? 400 : 0 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
