import { Camera, Droplets, Plus, ShieldCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'

// What a visitor sees before signing in: the app is open to look at, and signing in is asked for only
// when they want to do something (add a plant, open their garden).
export function WelcomePage() {
  const navigate = useNavigate()
  const features = [
    { icon: Droplets, title: 'Never forget to water', text: 'Every plant has its own rhythm. Thirsty ones come first.' },
    { icon: Camera, title: 'Watch them grow', text: 'Photos and notes on a timeline for each plant.' },
    { icon: ShieldCheck, title: 'Your garden is yours', text: 'Sign in with your account; nobody else sees your plants.' },
  ]
  return (
    <div className="grid gap-14 py-6">
      <section className="grid gap-6 text-center sm:py-10">
        <p className="mx-auto rounded-full border bg-card/70 px-3 py-1 text-sm text-muted-foreground">🌱 Your plants, looked after</p>
        <h1 className="font-heading text-5xl font-semibold tracking-tight sm:text-6xl">Keep every plant happy</h1>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground">
          Plant Parent reminds you when each plant needs water and keeps a photo diary of how it grows.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={() => navigate('/login?next=' + encodeURIComponent('/?add=1'))}>
            <Plus /> Add plant
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/login">Sign in to your garden</Link>
          </Button>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {features.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-3xl border bg-card/70 p-6">
            <span className="mb-4 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-5" />
            </span>
            <h2 className="font-heading text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
