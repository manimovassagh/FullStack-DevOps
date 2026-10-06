// Theme = mode (light / dark / system, via next-themes) + accent palette (data-palette on <html>).
import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

export const PALETTES = [
  { id: 'emerald', name: 'Emerald', a: '#6ee7b7', b: '#10b981' },
  { id: 'ocean', name: 'Ocean', a: '#7dd3fc', b: '#0284c7' },
  { id: 'violet', name: 'Violet', a: '#c4b5fd', b: '#7c3aed' },
  { id: 'sunset', name: 'Sunset', a: '#fdba74', b: '#ea580c' },
  { id: 'rose', name: 'Rose', a: '#fda4af', b: '#e11d48' },
  { id: 'graphite', name: 'Graphite', a: '#d4d4d8', b: '#52525b' },
] as const
const KEY = 'control-panel-palette'

export function usePalette() {
  const [palette, set] = useState(() => { try { return localStorage.getItem(KEY) ?? 'emerald' } catch { return 'emerald' } })
  useEffect(() => {
    document.documentElement.dataset.palette = palette
    try { localStorage.setItem(KEY, palette) } catch { /* private mode */ }
    window.dispatchEvent(new Event('palettechange'))
  }, [palette])
  return [palette, set] as const
}

// Re-render charts when the palette changes (they read the accent colour from CSS).
export function usePaletteVersion() {
  const [v, setV] = useState(0)
  useEffect(() => {
    const on = () => setV((x) => x + 1)
    window.addEventListener('palettechange', on)
    return () => window.removeEventListener('palettechange', on)
  }, [])
  return v
}

export function ThemeMenu() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [palette, setPalette] = usePalette()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const modes = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]] as const
  return (
    <div ref={ref} className="relative order-last">
      <button onClick={() => setOpen((o) => !o)} aria-label="Theme" aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-full border bg-card/70 px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:text-foreground">
        <Palette className="size-4" />
        <span className="size-3.5 rounded-full brand-gradient ring-1 ring-black/10" />
        {resolvedTheme === 'dark' ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
      </button>
      {open && (
        <div role="dialog" aria-label="Theme" className="glass absolute right-0 top-11 z-50 w-72 rounded-2xl !bg-popover p-4 shadow-2xl animate-in fade-in zoom-in-95">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mode</div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1">
            {modes.map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTheme(id)} aria-pressed={theme === id}
                className={cn('flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm transition-colors', theme === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
          <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Accent</div>
          <div className="grid grid-cols-3 gap-2">
            {PALETTES.map((p) => (
              <button key={p.id} onClick={() => setPalette(p.id)} aria-pressed={palette === p.id} aria-label={`${p.name} accent`}
                className={cn('flex flex-col items-center gap-1.5 rounded-xl border p-2 text-xs transition-colors', palette === p.id ? 'border-foreground/40 bg-muted/60 text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                <span className="relative grid size-8 place-items-center rounded-full ring-1 ring-black/10" style={{ background: `linear-gradient(135deg, ${p.a}, ${p.b})` }}>
                  {palette === p.id && <Check className="size-4 text-white drop-shadow" />}
                </span>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
