// The hosted login follows the app's theme choice (next-themes keeps it in localStorage.theme).
;(() => {
  let t = null
  try { t = localStorage.getItem('theme') } catch { /* blocked storage: follow the system */ }
  const dark = t === 'dark' || ((!t || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
})()
