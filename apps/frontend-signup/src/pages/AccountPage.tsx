import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { account, errorMessage, type Profile } from '@/api'
import { useAuth } from '@/auth'
import { FormError } from '@/components/account/AuthCard'
import { PasswordInput, PasswordStrength } from '@/components/account/PasswordInput'
import { passwordOk } from '@/lib/password'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function Section({ icon: Icon, title, hint, children }: { icon: typeof UserRound; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="grid gap-6 rounded-3xl bg-card p-6 ring-1 ring-border md:grid-cols-[240px_1fr]">
      <div>
        <h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><Icon className="size-5 text-primary" />{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

export function AccountPage() {
  const { reload, logout, signOutEverywhere } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [nameErr, setNameErr] = useState<string | null>(null)
  const [pwErr, setPwErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    account.profile().then((p) => { setProfile(p); setName(p.name) }).catch((e) => toast.error(errorMessage(e)))
  }, [])

  const saveName = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('name'); setNameErr(null)
    try {
      setProfile(await account.rename(name.trim()))
      await reload()
      toast.success('Name saved')
    } catch (err) { setNameErr(errorMessage(err)) } finally { setBusy(null) }
  }
  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    if (!passwordOk(next)) return setPwErr('Pick a password that meets every rule below.')
    setBusy('pw'); setPwErr(null)
    try {
      await account.changePassword(current, next)
      setCurrent(''); setNext('')
      toast.success('Password changed')
    } catch (err) { setPwErr(errorMessage(err)) } finally { setBusy(null) }
  }
  const everywhere = async () => {
    if (!confirm('Sign out on every device, including this one?')) return
    setBusy('all')
    try {
      await signOutEverywhere()
      navigate('/login?note=everywhere', { replace: true })
    } catch (err) { toast.error(errorMessage(err)); setBusy(null) }
  }

  if (!profile) return <div className="h-96 animate-pulse rounded-3xl bg-muted" aria-label="Loading account" />
  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex items-center gap-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary font-heading text-2xl font-semibold text-primary-foreground">
          {(profile.name || profile.email).slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{profile.name || 'Your account'}</h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {profile.email}
            {profile.email_verified && <span className="flex items-center gap-1 text-primary"><ShieldCheck className="size-3.5" /> verified</span>}
          </p>
        </div>
      </div>

      <Section icon={UserRound} title="Profile" hint="How Plant Parent greets you.">
        <form onSubmit={saveName} className="grid max-w-md gap-3">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Name</span>
            <Input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Email</span>
            <Input value={profile.email} disabled />
          </label>
          <FormError error={nameErr} />
          <Button type="submit" className="w-fit" disabled={busy === 'name' || name.trim() === profile.name}>{busy === 'name' ? 'Saving…' : 'Save'}</Button>
        </form>
      </Section>

      <Section icon={KeyRound} title="Password" hint="Use one you do not use anywhere else.">
        <form onSubmit={changePassword} className="grid max-w-md gap-3">
          <input type="email" autoComplete="username" value={profile.email} readOnly hidden />
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Current password</span>
            <PasswordInput name="current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">New password</span>
            <PasswordInput name="new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </label>
          <PasswordStrength password={next} />
          <FormError error={pwErr} />
          <Button type="submit" className="w-fit" disabled={busy === 'pw'}>{busy === 'pw' ? 'Changing…' : 'Change password'}</Button>
        </form>
      </Section>

      <Section icon={MonitorSmartphone} title="Sessions" hint="Lost a phone, or used a shared computer?">
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void logout().then(() => navigate('/'))}><LogOut /> Sign out here</Button>
          <Button variant="destructive" disabled={busy === 'all'} onClick={() => void everywhere()}>
            <MonitorSmartphone /> {busy === 'all' ? 'Signing out…' : 'Sign out everywhere'}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Everywhere ends every session: other devices are signed out at their next request (within the hour).</p>
      </Section>
    </div>
  )
}
