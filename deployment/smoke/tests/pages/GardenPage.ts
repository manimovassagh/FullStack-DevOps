import { expect, type Page } from '@playwright/test'

export type NewPlant = { name: string; species?: string; everyDays?: number }

// The home page: every plant, and the dialog that adds one.
export class GardenPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto('/')
  }

  async addPlant({ name, species = 'Nephrolepis exaltata', everyDays = 3 }: NewPlant) {
    await this.page.getByRole('button', { name: 'Add plant' }).first().click()
    await this.page.getByLabel('Name').fill(name)
    await this.page.getByLabel('Species').fill(species)
    await this.page.getByLabel('Water every (days)').fill(String(everyDays))
    await this.page.getByRole('button', { name: 'Add to garden' }).click()
  }

  plantLink(name: string) {
    return this.page.getByRole('link', { name })
  }

  async openPlant(name: string) {
    await this.plantLink(name).click()
    await expect(this.page).toHaveURL(/\/plants\/[0-9a-f-]{36}$/)
  }
}
