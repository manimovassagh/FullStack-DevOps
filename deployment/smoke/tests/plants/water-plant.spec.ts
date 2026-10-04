import { test } from '../fixtures'

test.describe('watering', () => {
  test('watering a plant records it on the timeline', async ({ plant: _plant, plantPage }) => {
    await plantPage.water()
  })
})
