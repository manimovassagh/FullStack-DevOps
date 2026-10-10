// Sign-in for an app that has none: the load balancer (real AWS) or oauth2-proxy (Floci) owns the session,
// this script only shows it and sends people to the hosted login when they need it.
//   GET  /oauth2/userinfo → 200 {email} signed in, 401 not
//   GET  /oauth2/start?rd=<path> → hosted login, then back to <path>
//   GET  /signout → session cookie and the hosted login's session removed, back on the app
;(() => {
  const here = () => location.pathname + location.search
  const signIn = () => location.assign('/oauth2/start?rd=' + encodeURIComponent(here()))
  let user = null // null = not signed in, otherwise { email }

  // Changes need a session. Signed out: go to the login before the click opens a form or sends anything.
  const isChange = (el) => {
    const b = el.closest('button, [role="button"], label')
    if (!b) return false
    const text = (b.getAttribute('aria-label') || b.textContent || '').trim()
    return /^(add plant|water |delete |upload)/i.test(text)
  }
  // A click before /oauth2/userinfo has answered waits for it, then goes ahead (signed in) or to the login.
  let known = false
  let ready
  const replayed = new WeakSet()
  document.addEventListener('click', (e) => {
    const el = e.target
    if (user || !(el instanceof Element) || !isChange(el)) return
    if (replayed.has(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (known) return signIn()
    ready.then(() => {
      if (!user) return signIn()
      const again = new MouseEvent('click', { bubbles: true, cancelable: true })
      replayed.add(again)
      el.dispatchEvent(again)
    })
  }, true)

  // Anything that still reaches the API without a session (401) also goes to the login.
  const realFetch = window.fetch.bind(window)
  window.fetch = async (...args) => {
    const res = await realFetch(...args)
    const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]), location.href)
    if (res.status === 401 && url.pathname.startsWith('/api/')) signIn()
    return res
  }

  const style = 'font:500 14px/1 system-ui,sans-serif;border-radius:999px;padding:9px 16px;cursor:pointer;' +
    'border:1px solid var(--color-border,#d4d4d8);'
  const box = document.createElement('div')
  box.id = 'plant-signin'
  box.style.cssText = 'display:flex;align-items:center;gap:10px;margin-left:auto;margin-right:8px'

  const render = () => {
    box.replaceChildren()
    if (user) {
      const who = document.createElement('span')
      who.textContent = user.email || 'Signed in'
      who.style.cssText = 'font:14px system-ui,sans-serif;opacity:.75'
      const out = document.createElement('a')
      out.href = '/signout' // the load balancer chains the app's and the hosted login's sign-out
      out.textContent = 'Sign out'
      out.style.cssText = style + 'background:transparent;color:inherit;text-decoration:none'
      box.append(who, out)
    } else {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = 'Sign in'
      btn.style.cssText = style + 'background:var(--color-primary,#15803d);color:var(--color-primary-foreground,#fff);border-color:transparent'
      btn.onclick = signIn
      box.append(btn)
    }
  }

  // React owns the header and may re-render it: put the box back whenever it goes missing.
  const mount = () => {
    const bar = document.querySelector('header > div')
    if (bar && !bar.contains(box)) bar.insertBefore(box, bar.lastElementChild)
  }
  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true })

  ready = realFetch('/oauth2/userinfo', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((u) => (u && u.email ? u : null)) // the open GET route answers {} without a session
    .catch(() => null)
    .then((u) => { user = u; known = true; render(); mount() })
})()
