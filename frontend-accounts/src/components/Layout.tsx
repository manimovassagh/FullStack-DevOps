import { LogIn, LogOut, Moon, Sprout, Sun, UserRound } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Link, Outlet, useNavigate } from 'react-router'
import { useAuth } from '@/auth'
import { Button } from '@/components/ui/button'

export function Layout() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  const { user, status, logout } = useAuth()
  const navigate = useNavigate()

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
          <div className="flex items-center gap-1">
          {status === 'signedIn' ? (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/account" title={user?.username}>
                  <span className="grid size-6 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                    {(user?.name || user?.username || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden sm:inline" data-testid="whoami">
                    {user?.name || user?.username}{user?.admin && ' (admin)'}
                    {user?.name && <span className="sr-only"> ({user.username})</span>}
                  </span>
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void logout().then(() => navigate('/'))} aria-label="Sign out">
                <LogOut /> <span className="hidden sm:inline">Sign out</span>
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/login">
                  <LogIn /> Sign in
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/signup"><UserRound /> Sign up</Link>
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(dark ? 'light' : 'dark')}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
