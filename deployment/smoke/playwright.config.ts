import { defineConfig, devices } from '@playwright/test'

// Usage: SMOKE_STAGE=ecs SMOKE_BASE_URL=http://localhost:8089 npx playwright test
// SMOKE_STAGE (classic-ec2 | ecs | eks | serverless) names the deployment under test: it ends up in the
// output folder, the project name (so in every video/screenshot folder) and as a label burned into the video.
const stage = process.env.SMOKE_STAGE ?? 'local'
export default defineConfig({
  testDir: './tests',
  outputDir: `test-results/${stage}`,
  timeout: 60_000,
  workers: 1, // one browser at a time: stages are small, and the recording stays readable
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: `playwright-report/${stage}` }]] : 'list',
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:8088',
    trace: 'retain-on-failure',
    screenshot: 'on',
    // CI keeps a video of every run as proof the deployed UI works; slowMo makes it watchable.
    // SMOKE_VIDEO=off skips recording (it needs Playwright's ffmpeg download).
    video: process.env.SMOKE_VIDEO === 'off' ? 'off' : process.env.CI ? { mode: 'on', size: { width: 1280, height: 800 } } : 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
    launchOptions: { slowMo: process.env.CI ? 400 : 0 },
  },
  // SMOKE_BROWSER_CHANNEL=chrome uses the Chrome installed on this machine instead of Playwright's download.
  projects: [{ name: stage, use: { ...devices['Desktop Chrome'], channel: process.env.SMOKE_BROWSER_CHANNEL || undefined } }],
})
