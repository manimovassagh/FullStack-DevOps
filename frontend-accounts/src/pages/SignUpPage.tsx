import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { account, errorMessage } from '@/api'
import { useAuth } from '@/auth'
import { AuthCard, FormError } from '@/components/account/AuthCard'
import { PasswordInput, PasswordStrength } from '@/components/account/PasswordInput'
import { passwordOk } from '@/lib/password'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { safeNext } from '@/lib/next'

export function SignUpPage() {
  const { status } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!passwordOk(password)) return setError('Pick a password that meets every rule below.')
    setBusy(true)
    setError(null)
    try {
      const r = await account.signUp(email.trim(), password, name.trim())
      navigate(`/confirm?email=${encodeURIComponent(email.trim())}&sent=${encodeURIComponent(r.sent_to)}&next=${encodeURIComponent(next)}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'signedIn') return <Navigate replace to={next} />
  return (
    <AuthCard title="Create your account" subtitle="Track watering and photos for every plant you own." onSubmit={submit}
      footer={<>Already have an account? <Link className="font-medium text-primary hover:underline" to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>}>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Name</span>
        <Input name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Email</span>
        <Input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Password</span>
        <PasswordInput name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <PasswordStrength password={password} />
      <FormError error={error} />
      <Button type="submit" className="w-full" size="lg" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</Button>
      <p className="text-center text-xs text-muted-foreground">We will email you a 6-digit code to confirm it is you.</p>
    </AuthCard>
  )
}
