import { expect, test } from '../fixtures'

test.describe('deleting a plant', () => {
  test('a deleted plant disappears from the garden', async ({ plant, plantPage, garden }) => {
    await plantPage.deletePlant()
    await expect(garden.plantLink(plant.name)).toHaveCount(0)
  })
})
