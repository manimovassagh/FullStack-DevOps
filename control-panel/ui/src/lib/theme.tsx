// Full themes: each one sets every surface (page, sidebar, cards, text) and the accent, plus light or dark mode.
// The look is data-theme on <html> (CSS in index.css); next-themes keeps the light/dark class in step.
import { useEffect, useRef, useState } from 'react'
import { Check, Palette, Search, Shuffle } from 'lucide-react'
import { useTheme } from 'next-themes'
import THEMES from '@/lib/themes.json'
import { cn } from '@/lib/utils'

export type Skin = (typeof THEMES)[number]
export { THEMES }
const KEY = 'control-panel-skin'
const DEFAULT = 'midnight'

function current(): string {
  try { return localStorage.getItem(KEY) ?? DEFAULT } catch { return DEFAULT }
}

// Every surface and accent variable a theme sets, from its row in themes.json. Dark themes lead with the bright
// accent (a), light themes with the deep one (b), so text on the accent stays readable in both.
const mix = (c: string, pct: number, base = 'transparent') => `color-mix(in oklab, ${c} ${pct}%, ${base})`
export function themeVars(t: Skin): Record<string, string> {
  const dark = t.mode === 'dark'
  const strong = dark ? t.a : t.b
  const other = dark ? t.b : t.a
  return {
    '--background': t.bg, '--foreground': t.fg, '--card': t.card, '--card-foreground': t.fg,
    '--popover': t.card, '--popover-foreground': t.fg,
    '--muted': mix(t.fg, 7, t.card), '--muted-foreground': t.muted,
    '--secondary': mix(t.fg, 8, t.card), '--secondary-foreground': t.fg,
    '--accent': mix(strong, 14, t.card), '--accent-foreground': t.fg,
    '--border': mix(t.fg, dark ? 11 : 12), '--input': mix(t.fg, 15),
    '--sidebar': t.sidebar,
    '--brand-1': t.a, '--brand-2': t.b, '--brand-ink': t.ink, '--brand-text': strong,
    '--brand-soft': mix(strong, 15), '--brand-ring': mix(strong, 35),
    '--primary': strong, '--primary-foreground': t.ink, '--ring': strong,
    '--glow-a': mix(strong, dark ? 16 : 14), '--glow-b': mix(other, dark ? 14 : 18),
    '--glass-top': dark ? mix(t.card, 94, '#ffffff') : mix(t.card, 96, t.fg), '--glass-bottom': mix(t.card, 90),
    '--glass-line': dark ? 'oklch(1 0 0 / 8%)' : '#ffffff',
    '--glass-shadow': dark
      ? '0 1px 0 0 oklch(1 0 0 / 5%) inset, 0 20px 44px -24px oklch(0 0 0 / 65%)'
      : '0 1px 2px oklch(0.2 0.02 260 / 6%), 0 12px 32px -16px oklch(0.2 0.02 260 / 16%)',
  }
}

// Paints a theme on <html> (also used for the hover preview in the picker).
function paint(t: Skin) {
  const el = document.documentElement
  el.dataset.theme = t.id
  for (const [k, v] of Object.entries(themeVars(t))) el.style.setProperty(k, v)
  el.classList.toggle('dark', t.mode === 'dark')
  window.dispatchEvent(new Event('palettechange'))
}

export function useSkin() {
  const { setTheme } = useTheme()
  const [id, setId] = useState(current)
  const skin = THEMES.find((t) => t.id === id) ?? THEMES[0]
  useEffect(() => {
    paint(skin)
    setTheme(skin.mode)
    try { localStorage.setItem(KEY, skin.id) } catch { /* private mode */ }
  }, [skin.id, skin.mode, setTheme])
  return [skin, setId] as const
}

// Charts read the accent from CSS: re-render them when the theme changes.
export function usePaletteVersion() {
  const [v, setV] = useState(0)
  useEffect(() => {
    const on = () => setV((x) => x + 1)
    window.addEventListener('palettechange', on)
    return () => window.removeEventListener('palettechange', on)
  }, [])
  return v
}

function Preview({ t }: { t: Skin }) {
  // a tiny picture of the panel in this theme: sidebar, a card with a title bar and the accent button
  return (
    <div className="relative h-16 w-full overflow-hidden rounded-lg ring-1 ring-black/10" style={{ background: t.bg }}>
      <div className="absolute inset-y-0 left-0 w-5" style={{ background: t.sidebar }}>
        <div className="mx-auto mt-2 size-2.5 rounded" style={{ background: `linear-gradient(135deg, ${t.a}, ${t.b})` }} />
      </div>
      <div className="absolute left-7 right-2 top-2 bottom-2 rounded-md p-1.5" style={{ background: t.card, boxShadow: '0 1px 2px rgba(0,0,0,.15)' }}>
        <div className="h-1.5 w-10 rounded-full" style={{ background: t.fg, opacity: 0.85 }} />
        <div className="mt-1 h-1 w-14 rounded-full" style={{ background: t.muted, opacity: 0.7 }} />
        <div className="mt-1.5 h-2.5 w-8 rounded" style={{ background: t.mode === 'dark' ? t.a : t.b }} />
      </div>
    </div>
  )
}

// Neovim colorschemes first (they carry their plugin as `source`), then the panel's own dark and light themes.
const GROUPS: { title: string; hint: string; match: (t: Skin) => boolean }[] = [
  { title: 'Neovim · dark', hint: 'the plugins\' own palettes', match: (t) => !!t.source && t.mode === 'dark' },
  { title: 'Neovim · light', hint: 'day variants', match: (t) => !!t.source && t.mode === 'light' },
  { title: 'Panel · dark', hint: 'originals', match: (t) => !t.source && t.mode === 'dark' },
  { title: 'Panel · light', hint: 'for daylight', match: (t) => !t.source && t.mode === 'light' },
]

// Any other dark theme, so a surprise is never the one already on screen.
function surprise(current: string): string {
  const pool = THEMES.filter((t) => t.mode === 'dark' && t.id !== current)
  return pool[Math.floor(Math.random() * pool.length)].id
}

function Swatches({ t }: { t: Skin }) {
  return (
    <div className="mt-1 flex h-1.5 overflow-hidden rounded-full">
      {[t.sidebar, t.card, t.muted, t.a, t.b].map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
    </div>
  )
}

export function ThemeMenu() {
  const [skin, setSkin] = useSkin()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const hit = (t: Skin) => !q || `${t.name} ${t.source} ${t.mode}`.toLowerCase().includes(q.toLowerCase())
  // Hover previews a theme on the whole panel; leaving the picker (or closing it) puts the chosen one back.
  const restore = () => paint(skin)
  useEffect(() => { if (!open) { paint(skin); setQ('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={ref} className="relative order-last">
      <button onClick={() => setOpen((o) => !o)} aria-label="Theme" aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-full border bg-card px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:text-foreground">
        <Palette className="size-4" /> <span className="hidden sm:inline">{skin.name}</span>
        <span className="size-3.5 rounded-full brand-gradient ring-1 ring-black/10" />
      </button>
      {open && (
        <div role="dialog" aria-label="Themes" onMouseLeave={restore} className="absolute right-0 top-11 z-50 max-h-[80vh] w-[520px] max-w-[92vw] overflow-y-auto rounded-2xl border bg-popover p-4 shadow-2xl animate-in fade-in zoom-in-95">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Themes <span className="font-normal text-muted-foreground">· {THEMES.length}</span></div>
            <button onClick={() => setSkin(surprise(skin.id))} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <Shuffle className="size-3.5" /> Surprise me
            </button>
          </div>
          <label className="mb-3 flex h-9 items-center gap-2 rounded-xl border bg-background/60 px-3 text-sm focus-within:ring-2 focus-within:ring-[var(--ring)]">
            <Search className="size-4 text-muted-foreground" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search themes (catppuccin, light, github…)"
              className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
          </label>
          {GROUPS.filter((g) => THEMES.some((t) => g.match(t) && hit(t))).map((g) => (
            <div key={g.title} className="mb-4 last:mb-0">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</span>
                <span className="text-[11px] text-muted-foreground/80">{g.hint}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {THEMES.filter((t) => g.match(t) && hit(t)).map((t) => (
                  <button key={t.id} onClick={() => setSkin(t.id)} onMouseEnter={() => paint(t)} onFocus={() => paint(t)} aria-pressed={skin.id === t.id} aria-label={`${t.name} theme`} title={t.source || t.name}
                    className={cn('group rounded-xl border p-1.5 text-left transition-all hover:-translate-y-0.5', skin.id === t.id ? 'border-transparent ring-2 ring-[var(--primary)]' : 'hover:border-foreground/30')}>
                    <Preview t={t} />
                    <Swatches t={t} />
                    <div className="mt-1 flex items-center justify-between px-0.5 text-xs font-medium">
                      <span className="truncate">{t.name}</span>
                      {skin.id === t.id && <Check className="size-3.5 shrink-0 text-[var(--primary)]" />}
                    </div>
                    {t.source && <div className="truncate px-0.5 font-mono text-[10px] text-muted-foreground">{t.source.split('/')[0]}</div>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
