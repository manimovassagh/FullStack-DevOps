import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { account, errorMessage } from '@/api'
import { AuthCard, FormError, FormNote } from '@/components/account/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { safeNext } from '@/lib/next'

const RESEND_WAIT = 30 // seconds before "send a new code" works again

// Step 2 of sign-up (and where an unconfirmed sign-in lands): the 6-digit code from the email.
export function ConfirmPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(params.get('sent') ? `We sent a code to ${params.get('sent')}.` : null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(params.get('sent') ? RESEND_WAIT : 0)
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await account.confirm(email.trim(), code)
      navigate(`/login?note=confirmed&email=${encodeURIComponent(email.trim())}&next=${encodeURIComponent(next)}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const resend = async () => {
    setError(null)
    try {
      await account.resend(email.trim())
      setNote('If an account is waiting for confirmation, a new code is on its way.')
      setWait(RESEND_WAIT)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <AuthCard title="Check your email" subtitle="Enter the 6-digit code to confirm your address." onSubmit={submit}
      footer={<Link className="hover:underline" to="/login">← Back to sign in</Link>}>
      {note && <FormNote>{note}</FormNote>}
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Email</span>
        <Input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Code</span>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="123456"
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus
          className="text-center font-mono text-2xl tracking-[0.5em]" />
      </label>
      <FormError error={error} />
      <Button type="submit" className="w-full" size="lg" disabled={busy || code.length !== 6}>{busy ? 'Confirming…' : 'Confirm email'}</Button>
      <Button type="button" variant="ghost" className="w-full" disabled={wait > 0 || !email} onClick={() => void resend()}>
        {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
      </Button>
    </AuthCard>
  )
}
