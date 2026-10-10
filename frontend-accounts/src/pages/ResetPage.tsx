import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { account, errorMessage } from '@/api'
import { AuthCard, FormError, FormNote } from '@/components/account/AuthCard'
import { PasswordInput, PasswordStrength } from '@/components/account/PasswordInput'
import { passwordOk } from '@/lib/password'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Password reset, step 2: the emailed code and the new password.
export function ResetPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!passwordOk(password)) return setError('Pick a password that meets every rule below.')
    setBusy(true)
    setError(null)
    try {
      await account.reset(email.trim(), code, password)
      navigate(`/login?note=reset&email=${encodeURIComponent(email.trim())}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthCard title="Choose a new password" subtitle="Enter the code from the email and your new password." onSubmit={submit}
      footer={<Link className="hover:underline" to={`/forgot?email=${encodeURIComponent(email)}`}>Didn’t get a code? Send another</Link>}>
      <FormNote>If an account exists for that address, a code is on its way.</FormNote>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Email</span>
        <Input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Code</span>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456"
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus
          className="text-center font-mono text-2xl tracking-[0.5em]" />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">New password</span>
        <PasswordInput name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <PasswordStrength password={password} />
      <FormError error={error} />
      <Button type="submit" className="w-full" size="lg" disabled={busy || code.length !== 6}>{busy ? 'Saving…' : 'Set new password'}</Button>
    </AuthCard>
  )
}
