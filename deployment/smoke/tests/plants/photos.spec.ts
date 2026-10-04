import { expect, test } from '../fixtures'

test.describe('photos', () => {
  test('an uploaded photo stays after a reload', async ({ plant: _plant, plantPage, page }) => {
    await plantPage.uploadPhoto('leaf.png')
    await page.reload()
    await expect(plantPage.deleteButtonFor('leaf.png')).toBeVisible()
  })
})
