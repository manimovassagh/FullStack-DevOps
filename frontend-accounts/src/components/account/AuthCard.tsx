import { Sprout } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router'

// The frame every sign-in / sign-up step shares: brand, title, one form, a footer with the way back.
export function AuthCard({ title, subtitle, onSubmit, children, footer }: {
  title: string; subtitle?: ReactNode; onSubmit: (e: FormEvent) => void; children: ReactNode; footer?: ReactNode
}) {
  return (
    <div className="grid min-h-svh place-items-center bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,var(--color-accent),transparent)] px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><Sprout className="size-5" /></span>
          <span className="font-heading text-xl font-semibold tracking-tight">Plant Parent</span>
        </Link>
        <form onSubmit={onSubmit} className="space-y-4 rounded-3xl bg-card p-7 shadow-lg ring-1 ring-border">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {children}
        </form>
        {footer && <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </div>
  )
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null
  return <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
}

export function FormNote({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{children}</p>
}
