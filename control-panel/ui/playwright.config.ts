import { defineConfig, devices } from '@playwright/test'

// Smoke test of the control panel itself (make -C control-panel test). The panel must be running (make).
// PANEL_BROWSER_CHANNEL=chrome uses the installed Chrome (set by the Makefile when Playwright's own download is missing).
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PANEL_URL ?? 'http://localhost:3500',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'panel', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, channel: process.env.PANEL_BROWSER_CHANNEL || undefined } }],
})
