// Signs in through a hosted login page (for example the Cognito hosted UI in front of an ALB) the way a person
// would, then saves the session: state.json for Playwright (SMOKE_STORAGE_STATE) and cookies.txt for curl
// (SMOKE_COOKIE_JAR). Usage: node hosted-login.mjs <base_url> <user> <password> <out_dir>
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [base, user, password, out] = process.argv.slice(2)
if (!base || !user || !password || !out) {
  console.error('usage: node hosted-login.mjs <base_url> <user> <password> <out_dir>')
  process.exit(2)
}

const browser = await chromium.launch({ channel: process.env.SMOKE_BROWSER_CHANNEL || undefined })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  // Where sign-in starts: the app's sign-in link (SMOKE_LOGIN_PATH), or any page when every page needs a session.
  await page.goto(base + (process.env.SMOKE_LOGIN_PATH || ''))
  await page.locator('input[name="username"]:visible').fill(user)
  await page.locator('input[name="password"]:visible').fill(password)
  await page.locator('[type="submit"]:visible').first().click()
  await page.waitForURL((url) => url.href.startsWith(base), { timeout: 30_000 })

  mkdirSync(out, { recursive: true })
  await context.storageState({ path: join(out, 'state.json') })
  const jar = (await context.cookies()).map((c) =>
    [c.domain, c.domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path,
      c.secure ? 'TRUE' : 'FALSE', Math.max(0, Math.round(c.expires)), c.name, c.value].join('\t'))
  writeFileSync(join(out, 'cookies.txt'), ['# Netscape HTTP Cookie File', ...jar, ''].join('\n'))
  console.log(`signed in as ${user}; session saved in ${out}`)
} finally {
  await browser.close()
}
