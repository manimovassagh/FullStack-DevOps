import { useState } from 'react'
import { Link } from 'react-router'
import { Search } from 'lucide-react'
import { useStatus, type Stage } from '@/lib/api'
import { ago, dur, now, verb } from '@/lib/format'
import { CLOUD, KIND_NAME, StageIcon, StatusBadge } from '@/components/bits'
import { LoginHint, StageButtons } from '@/pages/shared'
import { Loading } from '@/pages/Overview'
import { cn } from '@/lib/utils'

const FILTERS = [['all', 'All'], ['up', 'Running'], ['down', 'Stopped'], ['attention', 'Needs attention'], ['aws', 'AWS'], ['gcp', 'Google Cloud'], ['azure', 'Azure']] as const
const match = (s: Stage, f: string) =>
  f === 'up' ? s.state === 'up' || !!s.job : f === 'down' ? s.state === 'down' && !s.job : f === 'attention' ? s.state === 'partial' || s.state === 'stale'
    : ['aws', 'gcp', 'azure'].includes(f) ? s.family === f : true

export function Deployments() {
  const { data: s } = useStatus()
  const [filter, setFilter] = useState(() => localStorage.getItem('cp-filter') ?? 'all')
  const [q, setQ] = useState('')
  if (!s) return <Loading />
  const list = s.stages.filter((x) => match(x, filter) && `${x.title} ${x.note} ${x.id}`.toLowerCase().includes(q.toLowerCase()))
  const sections = (['aws', 'gcp', 'azure'] as const).flatMap((fam) =>
    (fam === 'aws' ? (['vm', 'container', 'k8s', 'serverless'] as const) : (['container'] as const)).map((kind) => ({
      fam, kind, items: list.filter((x) => x.family === fam && x.kind === kind),
    }))).filter((x) => x.items.length)
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-gradient text-3xl font-semibold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">Eleven ways to ship the same app. Deploy, test, release and tear down each one.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([id, label]) => (
          <button key={id} onClick={() => { setFilter(id); localStorage.setItem('cp-filter', id) }}
            className={cn('rounded-full border px-3 py-1 text-sm transition-colors', filter === id ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
            {label} <span className="opacity-60">{s.stages.filter((x) => match(x, id)).length}</span>
          </button>
        ))}
        <label className="ml-auto flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-1.5 sm:w-64">
          <Search className="size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deployments" className="w-full bg-transparent text-sm outline-none" />
        </label>
      </div>
      {sections.map(({ fam, kind, items }) => (
        <section key={fam + kind} className="grid gap-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span className={cn('size-2 rounded-sm', CLOUD[fam].color)} /> {CLOUD[fam].name}{fam === 'aws' && ` · ${KIND_NAME[kind]}`}
            <span className="font-normal">· {items.filter((x) => x.state === 'up').length}/{items.length} running</span>
          </h2>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{items.map((st) => <StageCard key={st.id} stage={st} />)}</div>
        </section>
      ))}
      {!sections.length && <p className="text-muted-foreground">No deployment matches.</p>}
    </div>
  )
}

export function StageCard({ stage: st }: { stage: Stage }) {
  return (
    <article className={cn('glass glass-hover group relative flex flex-col gap-3 overflow-hidden rounded-2xl p-4',
      st.state === 'up' && 'border-emerald-400/25', st.job && 'border-amber-400/35')}>
      <span className={cn('absolute inset-y-0 left-0 w-0.5', st.job ? 'bg-amber-400' : st.state === 'up' ? 'bg-emerald-400' : st.state === 'partial' ? 'bg-red-400' : st.state === 'stale' ? 'bg-violet-400' : 'bg-transparent')} />
      <Link to={`/deployments/${st.id}`} className="flex items-start gap-3">
        <StageIcon stage={st} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{st.title}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {st.url ? st.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : st.port ? `localhost:${st.port}` : st.emulator}
            {st.state === 'up' && !st.job && ` · up ${dur(now() - st.since)}`}
            {st.resources > 0 && ` · ${st.resources} resources`}
          </div>
        </div>
        <StatusBadge stage={st} />
      </Link>
      <p className="text-sm text-muted-foreground">{st.note}</p>
      {st.state === 'stale' && !st.job && <p className="rounded-lg bg-violet-500/10 px-3 py-2 text-xs text-violet-200">Its emulator was restarted and lost these resources. Redeploy clears the old state first.</p>}
      {st.state === 'up' && !st.job && <LoginHint stage={st} />}
      {st.job ? <JobProgress job={st.job} /> : st.last && (
        <div className="text-xs text-muted-foreground"><span className={st.last.rc === 0 ? 'text-emerald-400' : 'text-red-400'}>{st.last.rc === 0 ? '✓' : '✗'}</span> {verb(st.last.action).toLowerCase()} {st.last.rc === 0 ? 'done' : 'failed'} · {dur(st.last.ended - st.last.started)} · {ago(st.last.ended)}</div>
      )}
      <div className="mt-auto"><StageButtons stage={st} compact /></div>
    </article>
  )
}

export function JobProgress({ job }: { job: NonNullable<Stage['job']> }) {
  const t = now() - job.started, exp = job.expected ?? 300
  return (
    <div className="grid gap-1.5 rounded-xl border bg-muted/30 p-3">
      <div className="flex justify-between text-xs text-muted-foreground"><span>{verb(job.action)} · {dur(t)}</span><span>{t > exp ? 'longer than usual' : `~${dur(exp - t)} left`}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="relative h-full overflow-hidden rounded-full bg-amber-400 transition-all duration-700" style={{ width: `${Math.min(97, (t / exp) * 100)}%` }}><span className="absolute inset-0 animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" /></div></div>
      <div className="truncate font-mono text-[11px] text-muted-foreground">{job.step || 'working…'}</div>
    </div>
  )
}
