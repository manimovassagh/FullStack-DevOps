import { expect, type Page } from '@playwright/test'
import { PNG } from '../support/assets'

// One plant: its schedule, photos and timeline.
export class PlantPage {
  constructor(private readonly page: Page) {}

  heading(name: string) {
    return this.page.getByRole('heading', { level: 1, name })
  }

  async uploadPhoto(filename = 'leaf.png') {
    await this.page.getByLabel('Upload files').setInputFiles({ name: filename, mimeType: 'image/png', buffer: PNG })
    await expect(this.deleteButtonFor(filename)).toBeVisible()
  }

  deleteButtonFor(filename: string) {
    return this.page.getByRole('button', { name: `Delete ${filename}` })
  }

  async water() {
    await this.page.getByRole('button', { name: 'Water now' }).click()
    await expect(this.page.getByText('Watered 💧').first()).toBeVisible()
  }

  async deletePlant() {
    await this.page.getByRole('button', { name: 'Delete' }).first().click()
    await this.page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await expect(this.page).toHaveURL(/\/$/)
  }
}
