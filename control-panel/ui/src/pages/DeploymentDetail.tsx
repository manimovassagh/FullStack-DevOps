import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { getLog, usePromRange, useStage, useStatus } from '@/lib/api'
import { ago, dur, now, verb } from '@/lib/format'
import { useActions } from '@/components/actions'
import { LogView } from '@/components/LogView'
import { CLOUD, Empty, Panel, StageIcon, StatusBadge, TimeChart } from '@/components/bits'
import { LoginHint, StageButtons } from '@/pages/shared'
import { JobProgress } from '@/pages/Deployments'
import { Loading, NoProm } from '@/pages/Overview'
import { cn } from '@/lib/utils'

// Resource name prefix each stage uses (Terraform var.name): ties Prometheus series to the stage.
const PREFIX: Record<string, string> = {
  'classic-ec2': 'plant-ec2', 'ec2-asg': 'plant-asg', ecs: 'plant-ecs', 'ecs-cognito': 'plant-cognito', 'ecs-blue-green': 'plant-ecs-bg',
  eks: 'plant-eks', 'eks-helm': 'plant-eks-helm', 'eks-gitops': 'plant-eks-gitops',
}
const TABS = ['overview', 'log', 'runs', 'metrics'] as const

export function DeploymentDetail() {
  const { id = '' } = useParams()
  const { data: d } = useStage(id)
  const { data: status } = useStatus()
  const [tab, setTab] = useState<(typeof TABS)[number]>('overview')
  if (!d) return <Loading />
  const st = d.status
  return (
    <div className="grid gap-5">
      <Link to="/deployments" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Deployments</Link>
      <div className="flex flex-wrap items-start gap-4">
        <StageIcon stage={st} className="size-12" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-gradient text-3xl font-semibold tracking-tight">{st.title}</h1><StatusBadge stage={st} /></div>
          <p className="text-sm text-muted-foreground">{st.note}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className={cn('size-2 rounded-sm', CLOUD[st.family].color)} />{CLOUD[st.family].name}</span>
            <span>{d.dir}</span>
            {st.url && <a href={st.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sky-700 dark:text-sky-300 hover:underline">{st.url} <ExternalLink className="size-3" /></a>}
            {st.state === 'up' && <span>up {dur(now() - st.since)}</span>}
          </p>
        </div>
      </div>
      <Panel bodyClass="grid gap-3">
        <StageButtons stage={st} />
        {st.job && <JobProgress job={st.job} />}
        {st.state === 'up' && <LoginHint stage={st} />}
        {status?.ci_running && <p className="text-xs text-amber-600 dark:text-amber-300">A pipeline is running on Docker: actions are paused until it finishes.</p>}
      </Panel>
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors', tab === t ? 'border-emerald-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t === 'log' ? 'Live log' : t}{t === 'runs' && <span className="ml-1.5 text-xs opacity-60">{d.runs.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab d={d} live={st.state === 'up'} />}
      {tab === 'log' && <LiveLog job={st.job?.id ?? st.last?.id} />}
      {tab === 'runs' && <RunsTab runs={d.runs} />}
      {tab === 'metrics' && <MetricsTab id={st.id} prom={!!status?.tools.prometheus} />}
    </div>
  )
}

function OverviewTab({ d, live }: { d: NonNullable<ReturnType<typeof useStage>['data']>; live: boolean }) {
  const outputs = Object.entries(d.outputs)
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Outputs (terraform output)">
        {outputs.length ? (
          <dl className="grid gap-2 text-sm">
            {outputs.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[180px_1fr] gap-3 border-b border-border/50 pb-2 last:border-0">
                <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-all font-mono text-xs">{typeof v === 'string' ? (v.startsWith('http') && live ? <a className="text-sky-700 dark:text-sky-300 hover:underline" href={v} target="_blank" rel="noreferrer">{v}</a> : v) : JSON.stringify(v)}</dd>
              </div>
            ))}
          </dl>
        ) : <Empty>Not deployed. Outputs appear here after a deploy.</Empty>}
      </Panel>
      <Panel title={`Cloud resources (${d.resources.reduce((a, [, n]) => a + n, 0)})`}>
        {d.resources.length ? (
          <div className="flex flex-wrap gap-1.5">
            {d.resources.map(([t, n]) => <span key={t} className="rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-xs">{t.replace(/^aws_|^google_|^azurerm_/, '')}{n > 1 && <span className="ml-1 text-muted-foreground">×{n}</span>}</span>)}
          </div>
        ) : <Empty>No resources in the Terraform state.</Empty>}
      </Panel>
      <Panel title="What the buttons run" className="xl:col-span-2">
        <div className="grid gap-2 font-mono text-xs">
          {Object.entries(d.commands).map(([k, v]) => <div key={k} className="flex gap-3"><span className="w-16 text-muted-foreground">{k}</span><code className="rounded bg-muted px-2 py-0.5">cd {d.dir} && {v}</code></div>)}
        </div>
      </Panel>
    </div>
  )
}

function LiveLog({ job }: { job?: string }) {
  const [lines, setLines] = useState<string[]>([])
  const [meta, setMeta] = useState('')
  const from = useRef(0)
  useEffect(() => {
    if (!job) return
    let alive = true
    from.current = 0
    setLines([])
    const tick = async () => {
      try {
        const j = await getLog(job, from.current)
        if (!alive) return
        from.current = j.next
        if (j.lines.length) setLines((p) => [...p, ...j.lines])
        setMeta(`${verb(j.action)} · ${j.rc === null ? 'running' : j.rc === 0 ? 'done' : `failed (exit ${j.rc})`} · ${dur((j.ended ?? now()) - j.started)}`)
        if (j.rc === null) setTimeout(tick, 1000)
      } catch { if (alive) setTimeout(tick, 2000) }
    }
    void tick()
    return () => { alive = false }
  }, [job])
  if (!job) return <Empty>Nothing has run for this deployment yet.</Empty>
  return (
    <Panel title="Live log" action={<span className="font-mono text-xs text-muted-foreground">{meta}</span>} bodyClass="p-0">
      <LogView lines={lines} className="h-[60vh] rounded-b-2xl" />
    </Panel>
  )
}

function RunsTab({ runs }: { runs: { id: string; action: string; rc: number; started: number; ended: number }[] }) {
  const { openLog } = useActions()
  if (!runs.length) return <Empty>No runs yet.</Empty>
  return (
    <Panel bodyClass="p-0">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-4 py-2">Result</th><th>Action</th><th>Started</th><th>Took</th><th /></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="cursor-pointer border-b border-border/50 hover:bg-muted/40" onClick={() => openLog(r.id, verb(r.action))}>
              <td className="px-4 py-2"><span className={r.rc === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{r.rc === 0 ? '✓ passed' : `✗ exit ${r.rc}`}</span></td>
              <td>{verb(r.action)}</td>
              <td className="text-muted-foreground">{new Date(r.started * 1000).toLocaleString()} · {ago(r.started)}</td>
              <td className="font-mono text-xs">{dur(r.ended - r.started)}</td>
              <td className="pr-4 text-right text-xs text-sky-700 dark:text-sky-300">View log →</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function MetricsTab({ id, prom }: { id: string; prom: boolean }) {
  const p = PREFIX[id]
  const targets = usePromRange(`sum by (target_group, state) (alb_targets{target_group=~"${p}-.*"}) > 0`, (m) => `${m.target_group.replace(p + '-', '')} ${m.state}`, 30, prom && !!p)
  const ecs = usePromRange(`ecs_service_running{cluster="${p}"}`, (m) => `${m.service} running`, 30, prom && !!p)
  const pods = usePromRange(`sum by (phase) (k8s_pods{cluster="${p}"})`, (m) => `pods ${m.phase}`, 30, prom && !!p)
  const k6 = usePromRange(`sum(rate(k6_http_reqs_total{testid=~"${id}-.*"}[30s]))`, () => 'requests / s', 30, prom)
  if (!prom) return <NoProm />
  if (!p) return <Empty>This deployment has no load balancer metrics in the exporter.</Empty>
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Load balancer targets"><TimeChart series={targets.data} stacked empty="No targets registered" /></Panel>
      <Panel title={id.startsWith('eks') ? 'Kubernetes pods' : 'ECS tasks running'}><TimeChart series={id.startsWith('eks') ? pods.data : ecs.data} empty="Not an ECS/EKS stage, or not deployed" /></Panel>
      <Panel title="Load test traffic (k6)" className="xl:col-span-2"><TimeChart series={k6.data} empty="No load test in the last 30 minutes. Run one from Load tests." /></Panel>
    </div>
  )
}
