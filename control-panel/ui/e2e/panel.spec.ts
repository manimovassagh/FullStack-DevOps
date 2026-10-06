import { expect, test, type Page } from '@playwright/test'

// Every page of the control panel renders, every link on it works, and the main controls respond.
const PAGES = ['/', '/deployments', '/observability', '/dashboards', '/loadtests', '/pipelines', '/activity']

// Fail on JavaScript errors and on API calls the panel's own server answers with a 5xx.
function guard(page: Page) {
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500 && !r.url().includes('/api/prom/')) problems.push(`${r.status()} ${r.url()}`)
  })
  return problems
}

async function linksOn(page: Page) {
  return page.$$eval('a[href]', (as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))])
}

test('every page renders with a title and no errors', async ({ page }) => {
  const problems = guard(page)
  for (const path of PAGES) {
    await page.goto(path)
    await expect(page.locator('main h1').first(), path).toBeVisible()
  }
  expect(problems).toEqual([])
})

test('every deployment has a working detail page', async ({ page, request }) => {
  const problems = guard(page)
  const { stages } = await (await request.get('/api/status')).json()
  for (const s of stages as { id: string; title: string }[]) {
    await page.goto(`/deployments/${s.id}`)
    await expect(page.locator('main h1'), s.id).toHaveText(s.title)
    for (const tab of ['Live log', 'Runs', 'Metrics', 'Overview']) await page.getByRole('button', { name: new RegExp(`^${tab}`, 'i') }).click()
  }
  expect(problems).toEqual([])
})

test('every link on every page works', async ({ page, request }) => {
  test.setTimeout(240_000)
  const status = await (await request.get('/api/status')).json()
  const internal = new Set<string>(), external = new Set<string>()
  const pages = [...PAGES, ...status.stages.map((s: { id: string }) => `/deployments/${s.id}`)]
  for (const path of pages) {
    await page.goto(path)
    await page.locator('main h1').first().waitFor()
    for (const href of await linksOn(page)) (new URL(href).origin === new URL(page.url()).origin ? internal : external).add(href)
  }
  const broken: string[] = []
  for (const href of internal) {
    await page.goto(href)
    const rendered = await page.locator('main h1').first().waitFor({ timeout: 20_000 }).then(() => true, () => false)
    if (!rendered) broken.push(`${href} (page did not render)`)
  }
  for (const href of external) {
    const r = await request.get(href, { maxRedirects: 5, timeout: 15_000, failOnStatusCode: false }).catch((e) => ({ status: () => `unreachable (${e.message.split('\n')[0]})` }))
    const code = r.status()
    if (typeof code !== 'number' || code >= 400) broken.push(`${href} → ${code}`)
  }
  console.log(`checked ${internal.size} internal and ${external.size} external links`)
  expect(broken, 'broken links').toEqual([])
})

test('tools that are off lead to a page that can start them', async ({ page, request }) => {
  const { tools } = await (await request.get('/api/status')).json()
  await page.goto('/')
  for (const [key, label] of [['grafana', 'Grafana'], ['prometheus', 'Prometheus'], ['gitea', 'Local CI (Gitea)']] as const) {
    const link = page.locator('aside').getByRole('link', { name: new RegExp(label.replace(/[()]/g, '\\$&')) })
    if (tools[key]) await expect(link).toHaveAttribute('target', '_blank')
    else await expect(link).toHaveAttribute('href', /\/(pipelines|dashboards)$/)
  }
})

test('theme switch, filters and the log drawer respond', async ({ page, request }) => {
  await page.goto('/deployments')
  const html = page.locator('html')
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('button', { name: /Light/ }).click()
  await expect(html).not.toHaveClass(/dark/)
  await page.getByRole('button', { name: 'Ocean accent' }).click()
  await expect(html).toHaveAttribute('data-palette', 'ocean')
  await page.getByRole('button', { name: /Dark/ }).click()
  await expect(html).toHaveClass(/dark/)
  await page.getByRole('button', { name: 'Emerald accent' }).click()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /^Stopped/ }).click()
  await expect(page.getByText(/Running$/).first()).toBeHidden()
  await page.getByRole('button', { name: /^All/ }).click()

  const history = await (await request.get('/api/history')).json()
  if (history.length) {
    await page.goto('/activity')
    await page.locator('tbody tr').first().click()
    await expect(page.getByPlaceholder('Filter lines…')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Filter lines…')).toBeHidden()
  }
})
