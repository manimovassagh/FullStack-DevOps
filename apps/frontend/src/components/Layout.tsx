import { Moon, Sprout, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Link, Outlet } from 'react-router'
import { Button } from '@/components/ui/button'

export function Layout() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'

  return (
    <div className="min-h-svh bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,var(--color-accent),transparent)]">
      <header className="sticky top-0 z-20 border-b bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sprout className="size-5" />
            </span>
            <span className="font-heading text-xl font-semibold tracking-tight">Plant Parent</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(dark ? 'light' : 'dark')}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
