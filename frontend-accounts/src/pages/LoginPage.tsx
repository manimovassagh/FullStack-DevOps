import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiError, errorMessage } from '@/api'
import { useAuth } from '@/auth'
import { AuthCard, FormError, FormNote } from '@/components/account/AuthCard'
import { PasswordInput } from '@/components/account/PasswordInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { safeNext } from '@/lib/next'

const NOTES: Record<string, string> = {
  confirmed: 'Email confirmed. Sign in to start your garden.',
  reset: 'Password changed. Sign in with the new one.',
  everywhere: 'You were signed out on every device.',
}

export function LoginPage() {
  const { login, status } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      navigate(next, { replace: true })
    } catch (err) {
      // Right password, email not confirmed yet: straight to the code step.
      if (err instanceof ApiError && err.code === 'not_confirmed') {
        navigate(`/confirm?email=${encodeURIComponent(email.trim())}&next=${encodeURIComponent(next)}`)
        return
      }
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'signedIn') return <Navigate replace to={next} />
  const note = NOTES[params.get('note') ?? '']
  return (
    <AuthCard title="Welcome back" subtitle="Sign in to your garden." onSubmit={submit}
      footer={<>New here? <Link className="font-medium text-primary hover:underline" to={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></>}>
      {note && <FormNote>{note}</FormNote>}
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Email</span>
        <Input name="username" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!email} />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="flex items-center justify-between font-medium">
          Password
          <Link to={`/forgot?email=${encodeURIComponent(email.trim())}`} className="text-xs font-normal text-primary hover:underline">Forgot password?</Link>
        </span>
        <PasswordInput name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={!!email} />
      </label>
      <FormError error={error} />
      <Button type="submit" className="w-full" size="lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    </AuthCard>
  )
}
