import { expect, test } from '../fixtures'
import { login } from '../support/assets'

// Only stages that have a sign-in page (SMOKE_LOGIN_USER is set) run these.
test.describe('sign-in', () => {
  test.skip(!login.user, 'this stage has no sign-in')

  test('visitors see the home page, and adding a plant asks them to sign in first', async ({ page, loginPage }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Keep every plant happy' })).toBeVisible()
    await page.getByRole('button', { name: 'Add plant' }).click()
    await expect(page).toHaveURL(/\/login\?next=/)
    await loginPage.signIn(login.user!, login.password)
    // back on the garden, with the "new plant" form already open
    await expect(page.getByRole('dialog').getByText('New plant')).toBeVisible()
    await loginPage.expectSignedInAs(login.user!)
  })

  test('a plant page needs sign-in and comes back to it afterwards', async ({ page, loginPage }) => {
    await page.goto('/plants/00000000-0000-0000-0000-000000000000')
    await expect(page).toHaveURL(/\/login\?next=%2Fplants%2F/)
    await loginPage.signIn(login.user!, login.password)
    await expect(page).toHaveURL(/\/plants\/0{8}-/)
  })

  test('wrong password shows an error and stays on the form', async ({ loginPage }) => {
    await loginPage.open()
    await loginPage.signIn(login.user!, 'definitely-not-the-password')
    await expect(loginPage.error).toContainText('invalid username or password')
    await expect(loginPage.form).toBeVisible()
  })

  test('signing out returns to the public home page', async ({ garden, loginPage, page }) => {
    void garden
    await loginPage.signOut()
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page.getByTestId('whoami')).toHaveCount(0)
  })

  test('the session survives a reload (refresh cookie)', async ({ garden, loginPage, page }) => {
    void garden
    await page.reload()
    await loginPage.expectSignedInAs(login.user!)
  })
})
