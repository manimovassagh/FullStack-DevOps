import { expect, test } from '@playwright/test'

// A 1×1 PNG so the uploaded photo really renders in the timeline.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

// The journey a user takes after a deployment: add a plant, add a photo,
// water it, reload the deep link, then delete it again (leaves no data behind).
test('a user can manage a plant end to end', async ({ page }) => {
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
