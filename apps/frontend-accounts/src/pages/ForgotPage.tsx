import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { account, errorMessage } from '@/api'
import { AuthCard, FormError } from '@/components/account/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Password reset, step 1: email a code. The answer is the same whether or not the account exists.
export function ForgotPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await account.forgot(email.trim())
      navigate(`/reset?email=${encodeURIComponent(email.trim())}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthCard title="Reset your password" subtitle="We will email you a code to choose a new one." onSubmit={submit}
      footer={<Link className="hover:underline" to="/login">← Back to sign in</Link>}>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Email</span>
        <Input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </label>
      <FormError error={error} />
      <Button type="submit" className="w-full" size="lg" disabled={busy}>{busy ? 'Sending…' : 'Send reset code'}</Button>
    </AuthCard>
  )
}
