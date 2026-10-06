import { useState } from 'react'
import { useTheme } from 'next-themes'
import { BarChart3, ExternalLink, Flame, GitBranch, Search, Telescope } from 'lucide-react'
import { usePromRange, useStatus } from '@/lib/api'
import { useActions } from '@/components/actions'
import { Dot, Empty, Panel, TimeChart } from '@/components/bits'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// The observability tools, like the dashboards a cloud console has: Grafana boards embedded here, Prometheus
// for raw queries, Gitea for pipelines, and a metrics explorer that charts any PromQL query.
const GRAFANA = 'http://localhost:3400'
const BOARDS = [
  { id: 'stacks-overview', title: 'Stacks overview', what: 'Containers, ECS services, EKS pods, load balancer and Auto Scaling health' },
  { id: 'load-test', title: 'Load test (k6)', what: 'Virtual users, requests/s, latency percentiles and errors next to the containers doing the work' },
]
const TOOLS = [
  { key: 'grafana', title: 'Grafana', icon: BarChart3, url: GRAFANA, what: 'Dashboards over Prometheus', links: [['Dashboards', `${GRAFANA}/dashboards`], ['Explore', `${GRAFANA}/explore`]] },
  { key: 'prometheus', title: 'Prometheus', icon: Flame, url: 'http://localhost:9091', what: 'Metrics store: query and scrape targets', links: [['Query', 'http://localhost:9091/query'], ['Targets', 'http://localhost:9091/targets'], ['Metrics', 'http://localhost:9091/api/v1/label/__name__/values']] },
  { key: 'gitea', title: 'Gitea pipelines', icon: GitBranch, url: 'http://localhost:3300/ci/FullStack-DevOps/actions', what: 'The repo’s workflows run locally', links: [['Runs', 'http://localhost:3300/ci/FullStack-DevOps/actions']] },
] as const
const EXAMPLES = [
  ['Containers by kind', 'sum by (group) (container_up)'],
  ['CPU per container', 'topk(8, container_cpu_percent)'],
  ['Memory per container', 'topk(8, container_memory_bytes)'],
  ['ECS tasks running', 'ecs_service_running'],
  ['Kubernetes pods by phase', 'sum by (cluster, phase) (k8s_pods)'],
  ['Healthy targets', 'sum by (target_group) (alb_targets{state="healthy"})'],
  ['k6 requests/s', 'sum by (testid) (rate(k6_http_reqs_total[30s]))'],
  ['k6 p95 latency', 'max by (testid) (k6_http_req_duration_p95)'],
] as const

export function Dashboards() {
  const { data: s } = useStatus()
  const { run } = useActions()
  const [board, setBoard] = useState(BOARDS[0].id)
  const { resolvedTheme } = useTheme()
  const prom = !!s?.tools.prometheus, grafana = !!s?.tools.grafana
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-gradient text-3xl font-semibold tracking-tight">Dashboards</h1>
          <p className="text-sm text-muted-foreground">Grafana, Prometheus and the pipelines: the lab’s own CloudWatch.</p>
        </div>
        <span className="flex-1" />
        {!prom && <Button onClick={() => run({ path: '/api/observability/up', label: 'Observability', action: 'obs-up' })}><Telescope /> Start Prometheus + Grafana</Button>}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {TOOLS.map((t) => {
          const on = !!s?.tools[t.key]
          return (
            <div key={t.key} className="glass flex flex-col gap-3 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-400/20 to-sky-400/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-black/5 dark:ring-white/10"><t.icon className="size-5" /></span>
                <div className="min-w-0 flex-1"><div className="font-semibold">{t.title}</div><div className="truncate text-xs text-muted-foreground">{t.what}</div></div>
                <Dot on={on} />
              </div>
              <div className="flex flex-wrap gap-2">
                {t.links.map(([label, url]) => <Button key={label} size="sm" variant="outline" disabled={!on} asChild={on}>{on ? <a href={url} target="_blank" rel="noreferrer">{label} <ExternalLink /></a> : <span>{label}</span>}</Button>)}
              </div>
            </div>
          )
        })}
      </div>
      <Panel title="Grafana dashboards" bodyClass="p-0" action={
        <div className="flex gap-1">
          {BOARDS.map((b) => <button key={b.id} onClick={() => setBoard(b.id)} className={cn('rounded-full px-3 py-1 text-xs', board === b.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>{b.title}</button>)}
          <Button size="xs" variant="ghost" asChild><a href={`${GRAFANA}/d/${board}`} target="_blank" rel="noreferrer">Open in Grafana <ExternalLink /></a></Button>
        </div>}>
        {grafana ? (
          <iframe key={board + resolvedTheme} title={board} src={`${GRAFANA}/d/${board}?kiosk&theme=${resolvedTheme === 'light' ? 'light' : 'dark'}&refresh=10s`} className="h-[72vh] w-full rounded-b-2xl border-0" />
        ) : <div className="p-4"><Empty>Grafana is not running. Start Prometheus + Grafana above.</Empty></div>}
      </Panel>
      <Explorer enabled={prom} />
    </div>
  )
}

function Explorer({ enabled }: { enabled: boolean }) {
  const [draft, setDraft] = useState<string>(EXAMPLES[0][1])
  const [query, setQuery] = useState<string>(EXAMPLES[0][1])
  const [minutes, setMinutes] = useState(30)
  const label = (m: Record<string, string>) => Object.entries(m).filter(([k]) => k !== '__name__').map(([k, v]) => `${k}=${v}`).join(' ') || m.__name__ || 'value'
  const { data, error, isFetching } = usePromRange(query, label, minutes, enabled && !!query)
  const unit = /bytes/.test(query) ? 'bytes' : /percent/.test(query) ? '%' : /duration/.test(query) ? 's' : ''
  return (
    <Panel title="Metrics explorer (PromQL)" action={<div className="flex gap-1">{[15, 60, 360].map((m) => <button key={m} onClick={() => setMinutes(m)} className={cn('rounded-full px-2.5 py-0.5 text-xs', minutes === m ? 'bg-foreground text-background' : 'text-muted-foreground')}>{m < 60 ? `${m}m` : `${m / 60}h`}</button>)}</div>} bodyClass="grid gap-3">
      <form onSubmit={(e) => { e.preventDefault(); setQuery(draft.trim()) }} className="flex gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-xl border bg-background/60 px-3">
          <Search className="size-4 text-muted-foreground" />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} className="w-full bg-transparent py-2 font-mono text-sm outline-none" placeholder="e.g. sum by (group) (container_up)" />
        </label>
        <Button type="submit" disabled={!enabled}>{isFetching ? 'Running…' : 'Run query'}</Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map(([name, q]) => <button key={name} onClick={() => { setDraft(q); setQuery(q) }} className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors', query === q ? 'border-emerald-400/60 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground hover:text-foreground')}>{name}</button>)}
      </div>
      {!enabled ? <Empty>Prometheus is not running.</Empty> : error ? <Empty>Query failed: {(error as Error).message}</Empty> : <TimeChart series={data} unit={unit} height={300} empty="No series for this query in the chosen window" />}
    </Panel>
  )
}
