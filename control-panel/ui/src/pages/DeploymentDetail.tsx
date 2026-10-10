import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Copy, ExternalLink, Search } from 'lucide-react'
import { Marked } from 'marked'
import { toast } from 'sonner'
import { getLog, usePromRange, useStage, useStatus } from '@/lib/api'
import { ago, bytes, dur, now, verb } from '@/lib/format'
import { useActions } from '@/components/actions'
import { LogView } from '@/components/LogView'
import { CLOUD, Dot, Empty, Panel, StageIcon, StatusBadge, TimeChart } from '@/components/bits'
import { LoginHint, StageButtons } from '@/pages/shared'
import { JobProgress } from '@/pages/Deployments'
import { Loading, NoProm } from '@/pages/Overview'
import { cn } from '@/lib/utils'

// Resource name prefix each stage uses (Terraform var.name): ties Prometheus series to the stage.
const PREFIX: Record<string, string> = {
  'classic-ec2': 'plant-ec2', 'ec2-asg': 'plant-asg', ecs: 'plant-ecs', 'ecs-cognito': 'plant-cognito', 'ecs-blue-green': 'plant-ecs-bg',
  eks: 'plant-eks', 'eks-helm': 'plant-eks-helm', 'eks-gitops': 'plant-eks-gitops',
}
const TABS = ['overview', 'resources', 'containers', 'log', 'runs', 'metrics', 'docs'] as const

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
      <div className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('shrink-0 border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors', tab === t ? 'brand-border text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t === 'log' ? 'Live log' : t}
            {t === 'runs' && <span className="ml-1.5 text-xs opacity-60">{d.runs.length}</span>}
            {t === 'resources' && <span className="ml-1.5 text-xs opacity-60">{d.addresses.length}</span>}
            {t === 'containers' && <span className="ml-1.5 text-xs opacity-60">{d.containers.items.filter((c) => c.state === 'running').length}</span>}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab d={d} live={st.state === 'up'} />}
      {tab === 'log' && <LiveLog job={st.job?.id ?? st.last?.id} />}
      {tab === 'runs' && <RunsTab runs={d.runs} />}
      {tab === 'metrics' && <MetricsTab id={st.id} prom={!!status?.tools.prometheus} />}
      {tab === 'resources' && <ResourcesTab d={d} />}
      {tab === 'containers' && <ContainersTab c={d.containers} />}
      {tab === 'docs' && <DocsTab md={d.readme} dir={d.dir} />}
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

type Detail = NonNullable<ReturnType<typeof useStage>['data']>

// Every resource in the Terraform state, grouped by service (aws_lb_*, aws_ecs_* …), searchable.
function ResourcesTab({ d }: { d: Detail }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  if (!d.addresses.length) return <Empty>No resources in the Terraform state. Deploy the stage to see them.</Empty>
  const service = (t: string) => t.replace(/^(aws|google|azurerm)_/, '').split('_')[0]
  const list = d.addresses.filter((a) => `${a.address} ${a.name} ${a.id}`.toLowerCase().includes(q.toLowerCase()))
  const groups = [...new Set(list.map((a) => service(a.type)))].sort()
  return (
    <div className="grid gap-4">
      <label className="flex w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 sm:w-96">
        <Search className="size-4 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter (lb, ecs, cognito, an ARN…)" className="w-full bg-transparent text-sm outline-none" />
      </label>
      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((g) => {
          const items = list.filter((a) => service(a.type) === g)
          return (
            <Panel key={g} title={<span className="font-mono">{g} <span className="text-muted-foreground">· {items.length}</span></span>} bodyClass="p-1">
              {items.map((a) => (
                <button key={a.address} onClick={() => setOpen(open === a.address ? null : a.address)}
                  className="block w-full rounded-lg px-3 py-1.5 text-left hover:bg-muted/50">
                  <div className="truncate font-mono text-xs">{a.address}</div>
                  {a.name && <div className="truncate text-xs text-muted-foreground">{a.name}</div>}
                  {open === a.address && a.id && (
                    <div className="mt-1 flex items-start gap-2 rounded-md bg-muted/60 p-2 font-mono text-[11px] break-all">
                      <span className="flex-1">{a.id}</span>
                      <span role="button" tabIndex={0} title="Copy" onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(a.id); toast.success('Copied') }}><Copy className="size-3.5" /></span>
                    </div>
                  )}
                </button>
              ))}
            </Panel>
          )
        })}
      </div>
    </div>
  )
}

// The stage's emulator and everything on its Docker network: ECS tasks, RDS proxies, the registry.
function ContainersTab({ c }: { c: Detail['containers'] }) {
  if (!c.network) return <Empty>This deployment does not run on a local emulator.</Empty>
  const kind = (n: string) => n.endsWith('-floci-1') ? 'emulator' : n.includes('ecr-registry') ? 'image registry'
    : n.startsWith('floci-aws-ecs-') ? `${n.split('-').pop()} task` : n.includes('-rds-') ? 'database' : n.includes('-lambda-') ? 'function' : 'container'
  return (
    <Panel title={<>Containers <span className="font-normal text-muted-foreground">· network <span className="font-mono">{c.network}</span>{c.shared && ' (shared by several deployments)'}</span></>} bodyClass="p-0">
      {c.items.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-4 py-2">Role</th><th>Container</th><th>Image</th><th>State</th><th className="pr-4 text-right">CPU · memory</th></tr></thead>
          <tbody>
            {c.items.map((x) => (
              <tr key={x.name} className="border-b border-border/50">
                <td className="px-4 py-2 font-medium capitalize">{kind(x.name)}</td>
                <td className="max-w-[260px] truncate font-mono text-xs" title={x.name}>{x.name}</td>
                <td className="max-w-[220px] truncate font-mono text-xs text-muted-foreground" title={x.image}>{x.image}</td>
                <td><span className="flex items-center gap-1.5 text-xs"><Dot on={x.state === 'running'} />{x.status}</span></td>
                <td className="pr-4 text-right font-mono text-xs">{x.cpu.toFixed(1)}% · {bytes(x.mem)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="p-4"><Empty>No containers: start the emulator and deploy.</Empty></div>}
    </Panel>
  )
}

// READMEs are rendered as Markdown only: raw HTML in them is dropped and links keep safe schemes, so a file
// that ever carried a <script> or a javascript: link could not run anything in the panel.
const SAFE_HREF = /^(https?:|mailto:|#|\.{0,2}\/|[\w.-]+(\/|$))/i
const md = new Marked({
  renderer: {
    html: () => '',
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens)
      return SAFE_HREF.test(href) ? `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noreferrer noopener">${text}</a>` : text
    },
    image: ({ text }) => text.replace(/[<>&"]/g, ''),
  },
})

// The stage's README, rendered.
function DocsTab({ md: text, dir }: { md: string; dir: string }) {
  if (!text) return <Empty>No README.md in {dir}.</Empty>
  return (
    <Panel title={<span className="font-mono">{dir}/README.md</span>}>
      <article className="prose-panel" dangerouslySetInnerHTML={{ __html: md.parse(text, { async: false }) }} />
    </Panel>
  )
}
