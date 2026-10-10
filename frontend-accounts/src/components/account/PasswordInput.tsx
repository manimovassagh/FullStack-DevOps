import { Check, Eye, EyeOff, X } from 'lucide-react'
import { useState, type ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { PASSWORD_RULES } from '@/lib/password'
import { cn } from '@/lib/utils'

// A password field with a show/hide toggle.
export function PasswordInput(props: ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className={cn('pr-10', props.className)} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide characters' : 'Show characters'} aria-pressed={show}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export function PasswordStrength({ password }: { password: string }) {
  const met = PASSWORD_RULES.filter((r) => r.ok(password)).length
  const tone = ['bg-destructive', 'bg-destructive', 'bg-amber-500', 'bg-amber-500', 'bg-primary'][met]
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex gap-1">{PASSWORD_RULES.map((r, i) => <span key={r.label} className={cn('h-1.5 flex-1 rounded-full', i < met ? tone : 'bg-muted')} />)}</div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {PASSWORD_RULES.map((r) => {
          const ok = r.ok(password)
          return (
            <li key={r.label} className={cn('flex items-center gap-1.5', ok ? 'text-primary' : 'text-muted-foreground')}>
              {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}{r.label}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
