import { expect, test } from '../fixtures'
import { login } from '../support/assets'

// Only stages that have a sign-in page (SMOKE_LOGIN_USER is set) run these.
test.describe('sign-in', () => {
  test.skip(!login.user, 'this stage has no sign-in');

  test('wrong password shows an error and stays on the form', async ({ page, loginPage }) => {
    await page.goto('/')
    await loginPage.signIn(login.user!, 'definitely-not-the-password')
    await expect(loginPage.error).toContainText('invalid username or password')
    await expect(loginPage.form).toBeVisible()
  })

  test('signing in shows who you are, signing out returns to the form', async ({ garden, loginPage }) => {
    await loginPage.expectSignedInAs(login.user!)
    await loginPage.signOut()
    await expect(loginPage.form).toBeVisible()
  })

  test('the session survives a reload (refresh cookie)', async ({ garden, loginPage, page }) => {
    void garden
    await page.reload()
    await loginPage.expectSignedInAs(login.user!)
  })
})
