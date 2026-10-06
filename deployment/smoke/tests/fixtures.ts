import { test as base } from '@playwright/test'
import { GardenPage } from './pages/GardenPage'
import { LoginPage } from './pages/LoginPage'
import { PlantPage } from './pages/PlantPage'
import { login } from './support/assets'
import { labelRecording } from './support/stage'

type Fixtures = {
  loginPage: LoginPage
  garden: GardenPage
  plantPage: PlantPage
  // A plant that exists for the test and is deleted again afterwards (leaves no data behind).
  plant: { name: string }
}

export const test = base.extend<Fixtures>({
  // Runs before every test: stamps the stage into the video.
  page: async ({ page, baseURL }, use) => {
    await labelRecording(page, baseURL)
    await use(page)
  },

  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  plantPage: async ({ page }, use) => use(new PlantPage(page)),

  // The garden page, already signed in when the stage has a login.
  garden: async ({ page, loginPage }, use) => {
    const garden = new GardenPage(page)
    if (login.user) {
      await loginPage.open()
      await loginPage.signIn(login.user, login.password)
      await loginPage.expectSignedInAs(login.user)
    } else {
      await garden.open()
    }
    await use(garden)
  },

  plant: async ({ garden, plantPage, page }, use, testInfo) => {
    const name = `Smoke Fern ${testInfo.title.slice(0, 20)} ${Date.now()}`
    await garden.addPlant({ name })
    await garden.openPlant(name)
    await use({ name })
    // Teardown: remove it through the UI so the test works against any stage.
    if (!/\/$/.test(new URL(page.url()).pathname)) {
      await garden.open()
      await garden.openPlant(name)
      await plantPage.deletePlant()
    }
  },
})

export { expect } from '@playwright/test'
