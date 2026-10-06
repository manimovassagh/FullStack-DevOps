import { expect, type Page } from '@playwright/test'

export class LoginPage {
  constructor(private readonly page: Page) {}

  async open(next?: string) {
    await this.page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  }

  async signIn(user: string, password: string) {
    await this.page.getByLabel('Email').fill(user)
    await this.page.getByLabel('Password').fill(password)
    await this.page.getByRole('button', { name: 'Sign in' }).click()
  }

  async expectSignedInAs(user: string) {
    await expect(this.page.getByTestId('whoami')).toContainText(user)
  }

  async signOut() {
    await this.page.getByRole('button', { name: 'Sign out' }).click()
  }

  get error() {
    return this.page.getByRole('alert')
  }

  get form() {
    return this.page.getByRole('button', { name: 'Sign in' })
  }
}
