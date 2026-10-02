import { expect, test } from '@playwright/test'

// A 1×1 PNG so the uploaded photo really renders in the timeline.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

// What each stage is, shown in the recording so a video is recognisable on its own.
const STAGES: Record<string, string> = {
  'classic-ec2': 'EC2 + ALB',
  ecs: 'ECS Fargate',
  eks: 'EKS (Kubernetes)',
  serverless: 'Lambda + API Gateway + CloudFront',
}
const stage = process.env.SMOKE_STAGE ?? 'local'

// A small label in the corner of every page (pointer-events: none, so it never blocks a click).
test.beforeEach(async ({ page, baseURL }) => {
  const label = `${stage} · ${STAGES[stage] ?? 'local run'} · ${baseURL}`
  await page.addInitScript((text) => {
    window.addEventListener('DOMContentLoaded', () => {
      const el = document.createElement('div')
      el.textContent = text
      el.setAttribute('aria-hidden', 'true')
      el.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none;padding:6px 12px;' +
        'border-radius:999px;background:#111;color:#fff;font:600 13px/1.2 ui-monospace,monospace;opacity:.9'
      document.body.appendChild(el)
    })
  }, label)
})

// The journey a user takes after a deployment: add a plant, add a photo,
// water it, reload the deep link, then delete it again (leaves no data behind).
test(`[${stage}] a user can manage a plant end to end`, async ({ page }) => {
  const name = `Smoke Fern ${Date.now()}`

  await page.goto('/')
  await page.getByRole('button', { name: 'Add plant' }).first().click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Species').fill('Nephrolepis exaltata')
  await page.getByLabel('Water every (days)').fill('3')
  await page.getByRole('button', { name: 'Add to garden' }).click()

  await page.getByRole('link', { name }).click()
  await expect(page).toHaveURL(/\/plants\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  await page.getByLabel('Upload files').setInputFiles({ name: 'leaf.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('button', { name: 'Delete leaf.png' })).toBeVisible()

  await page.getByRole('button', { name: 'Water now' }).click()
  await expect(page.getByText('Watered 💧').first()).toBeVisible()

  // Deep link served by the frontend tier (SPA fallback), data by the API tier.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete leaf.png' })).toBeVisible()

  await page.getByRole('button', { name: 'Delete' }).first().click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name })).toHaveCount(0)
})
