import { expect, test } from '../fixtures'

test.describe('adding a plant', () => {
  test('a new plant shows up in the garden and has its own page', async ({ garden, plantPage, page }) => {
    const name = `Smoke Basil ${Date.now()}`
    await garden.addPlant({ name, species: 'Ocimum basilicum', everyDays: 2 })
    await expect(garden.plantLink(name)).toBeVisible()

    await garden.openPlant(name)
    await expect(plantPage.heading(name)).toBeVisible()

    // Tidy up through the UI.
    await plantPage.deletePlant()
    await expect(page).toHaveURL(/\/$/)
  })
})
