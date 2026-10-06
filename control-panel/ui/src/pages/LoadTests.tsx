import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Gauge, Play } from 'lucide-react'
import { usePromRange, useStatus, useHistory } from '@/lib/api'
import { ago, dur, now, verb } from '@/lib/format'
import { useActions } from '@/components/actions'
import { Empty, Kpi, Panel, TimeChart } from '@/components/bits'
import { Button } from '@/components/ui/button'
import { Loading, NoProm } from '@/pages/Overview'
import { cn } from '@/lib/utils'

const PROFILES = [
  { id: 'smoke', title: 'Smoke', shape: '1 user · 30 s', what: 'Does the user journey work at all?' },
  { id: 'load', title: 'Load', shape: '0 → 20 users · 4½ min', what: 'A normal busy day: stable latency, no errors?' },
  { id: 'spike', title: 'Spike', shape: '5 → 50 users in 10 s · 2 min', what: 'A sudden rush: does it bend or break?' },
  { id: 'stress', title: 'Stress', shape: '20 → 50 → 100 users · 3½ min', what: 'Where does it start to fail?' },
]

export function LoadTests() {
  const { data: s } = useStatus()
  const { data: hist } = useHistory()
  const { run, openLog } = useActions()
  const [params] = useSearchParams()
  const candidates = s?.stages.filter((x) => x.loadtest) ?? []
  const [stageId, setStageId] = useState(params.get('stage') ?? '')
  const [profile, setProfile] = useState('load')
  const prom = !!s?.tools.prometheus
  const running = s?.active.find((j) => j.action.startsWith('loadtest-'))
  const sel = stageId || running?.target.split(':')[1] || candidates.find((x) => x.state === 'up')?.id || ''
  // Runs carry stage=<id> (and older ones only testid=<id>-<profile>-<time>): match either.
  const f = `testid=~"${sel}-.*"`
  const vus = usePromRange(`sum(k6_vus{${f}})`, () => 'virtual users', 15, prom && !!sel)
  const rps = usePromRange(`sum(rate(k6_http_reqs_total{${f}}[30s]))`, () => 'requests / s', 15, prom && !!sel)
  const p95 = usePromRange(`max by (name) (k6_http_req_duration_p95{${f}})`, (m) => m.name, 15, prom && !!sel)
  const err = usePromRange(`max(k6_http_req_failed_rate{${f}})`, () => 'failed requests', 15, prom && !!sel)
  if (!s) return <Loading />
  const target = s.stages.find((x) => x.id === sel)
  const last = (series?: { points: { v: number }[] }[]) => series?.[0]?.points.at(-1)?.v
  const runs = (hist ?? []).filter((h) => h.target.startsWith('loadtest:')).slice(0, 15)
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-gradient text-3xl font-semibold tracking-tight">Load tests</h1>
        <p className="text-sm text-muted-foreground">k6 virtual users sign in, browse, add, water and delete plants. Metrics stream live from k6 into Prometheus.</p>
      </div>
      {!prom && <NoProm />}
      <Panel title="New run" bodyClass="grid gap-4">
        <div className="grid gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Deployment</span>
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => (
              <button key={c.id} onClick={() => setStageId(c.id)} disabled={c.state !== 'up'}
                className={cn('rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-40', sel === c.id ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300' : 'hover:border-foreground/30')}>
                {c.title} {c.state !== 'up' && <span className="text-xs">(not running)</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {PROFILES.map((p) => (
            <button key={p.id} onClick={() => setProfile(p.id)} className={cn('rounded-xl border p-3 text-left transition-colors', profile === p.id ? 'border-emerald-400 bg-emerald-500/10' : 'hover:border-foreground/30')}>
              <div className="flex items-center gap-2 font-semibold"><Gauge className="size-4" /> {p.title}</div>
              <div className="font-mono text-xs text-muted-foreground">{p.shape}</div>
              <div className="mt-1 text-sm text-muted-foreground">{p.what}</div>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button disabled={!target || target.state !== 'up' || !!running || !prom}
            onClick={() => run({ path: `/api/loadtests/${sel}/${profile}`, label: `${target?.title} · ${profile}`, action: `loadtest-${profile}` })}>
            <Play /> Run {profile} test on {target?.title ?? '…'}
          </Button>
          {running && <span className="text-sm text-amber-300">{verb(running.action)} running · {dur(now() - running.started)} · <button className="underline" onClick={() => openLog(running.id, 'Load test')}>log</button></span>}
          {!candidates.some((c) => c.state === 'up') && <span className="text-sm text-muted-foreground">Deploy a stage first (Deployments).</span>}
        </div>
      </Panel>
      {prom && sel && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Virtual users" value={Math.round(last(vus.data) ?? 0)} />
            <Kpi label="Requests / s" value={(last(rps.data) ?? 0).toFixed(1)} />
            <Kpi label="p95 (slowest endpoint)" value={`${Math.round(Math.max(0, ...(p95.data ?? []).map((x) => x.points.at(-1)?.v ?? 0)) * 1000)} ms`} />
            <Kpi label="Error rate" value={`${((last(err.data) ?? 0) * 100).toFixed(2)}%`} tone={(last(err.data) ?? 0) > 0.01 ? 'text-red-400' : 'text-emerald-400'} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Virtual users and requests per second (15 min)"><TimeChart series={[...(vus.data ?? []), ...(rps.data ?? [])]} empty="No load test on this deployment in the last 15 minutes" /></Panel>
            <Panel title="p95 latency by endpoint"><TimeChart series={p95.data} unit="s" empty="No load test on this deployment in the last 15 minutes" /></Panel>
          </div>
        </>
      )}
      <Panel title="Recent load tests" bodyClass="p-2">
        {runs.length ? runs.map((h) => (
          <button key={h.id} onClick={() => openLog(h.id, 'Load test')} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/50">
            <span className={h.rc === 0 ? 'text-emerald-400' : 'text-red-400'}>{h.rc === 0 ? '✓' : '✗'}</span>
            <span className="flex-1">{s.stages.find((x) => x.id === h.target.split(':')[1])?.title} · {h.action.replace('loadtest-', '')}</span>
            <span className="text-xs text-muted-foreground">{h.rc === 0 ? 'thresholds passed' : 'thresholds failed'} · {dur(h.ended - h.started)} · {ago(h.ended)}</span>
          </button>
        )) : <Empty>No load test run from the panel yet.</Empty>}
      </Panel>
    </div>
  )
}
