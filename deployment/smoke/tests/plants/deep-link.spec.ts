import { expect, test } from '../fixtures'

test.describe('deep links', () => {
  // The frontend tier serves the SPA for any path, the API tier serves the data; with sign-in the reload
  // also has to get the session back from the refresh cookie.
  test('reloading a plant page keeps the page and its data', async ({ plant, plantPage, page }) => {
    await page.reload()
    await expect(plantPage.heading(plant.name)).toBeVisible()
  })
})
