import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useContainers, usePromInstant, usePromRange, useStatus } from '@/lib/api'
import { bytes } from '@/lib/format'
import { useActions } from '@/components/actions'
import { Dot, Empty, Meter, Panel, TimeChart } from '@/components/bits'
import { Button } from '@/components/ui/button'
import { NoProm } from '@/pages/Overview'
import { cn } from '@/lib/utils'

export function Observability() {
  const { data: s } = useStatus()
  const { run } = useActions()
  const prom = !!s?.tools.prometheus
  const mem = usePromRange('topk(6, container_memory_bytes)', (m) => m.name.replace(/^floci-/, '').slice(0, 34), 30, prom)
  const targets = usePromRange('sum by (state) (alb_targets) > 0', (m) => m.state, 30, prom)
  const ecs = usePromInstant('ecs_service_running', prom)
  const ecsDesired = usePromInstant('ecs_service_desired', prom)
  const pods = usePromInstant('sum by (cluster, namespace, phase) (k8s_pods)', prom)
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-gradient text-3xl font-semibold tracking-tight">Observability</h1>
          <p className="text-sm text-muted-foreground">What runs where: every container, ECS service, Kubernetes pod and load balancer target.</p>
        </div>
        <span className="flex-1" />
        <Button variant="outline" size="sm" asChild><a href="http://localhost:3400/d/stacks-overview" target="_blank" rel="noreferrer"><ExternalLink /> Grafana: stacks</a></Button>
        <Button variant="outline" size="sm" asChild><a href="http://localhost:3400/d/load-test" target="_blank" rel="noreferrer"><ExternalLink /> Grafana: load test</a></Button>
        <Button size="sm" variant={prom ? 'ghost' : 'default'} onClick={() => run({ path: `/api/observability/${prom ? 'down' : 'up'}`, label: 'Observability', action: prom ? 'obs-down' : 'obs-up' })}>
          <Dot on={prom} /> {prom ? 'Stop Prometheus + Grafana' : 'Start Prometheus + Grafana'}
        </Button>
      </div>
      <ContainersTable />
      {prom ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Memory · biggest containers"><TimeChart series={mem.data} unit="bytes" /></Panel>
            <Panel title="Load balancer targets by health"><TimeChart series={targets.data} stacked empty="No load balancer targets" /></Panel>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="ECS services" bodyClass="p-0">
              {ecs.data?.length ? (
                <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-4 py-2">Cluster / service</th><th>Running</th><th>Desired</th><th>Task definition</th></tr></thead>
                  <tbody>{ecs.data.map((r) => {
                    const want = ecsDesired.data?.find((x) => x.metric.cluster === r.metric.cluster && x.metric.service === r.metric.service)?.value ?? 0
                    return <tr key={r.metric.cluster + r.metric.service} className="border-b border-border/50"><td className="px-4 py-2 font-mono text-xs">{r.metric.cluster}/{r.metric.service}</td>
                      <td className={cn('font-semibold', r.value >= want ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-300')}>{r.value}</td><td>{want}</td><td className="font-mono text-xs text-muted-foreground">{r.metric.task_definition}</td></tr>
                  })}</tbody></table>
              ) : <div className="p-4"><Empty>No ECS service running.</Empty></div>}
            </Panel>
            <Panel title="Kubernetes pods" bodyClass="p-0">
              {pods.data?.length ? (
                <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-4 py-2">Cluster</th><th>Namespace</th><th>Phase</th><th>Pods</th></tr></thead>
                  <tbody>{pods.data.map((r) => <tr key={JSON.stringify(r.metric)} className="border-b border-border/50"><td className="px-4 py-2 font-mono text-xs">{r.metric.cluster}</td><td>{r.metric.namespace}</td><td className={r.metric.phase === 'Running' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-300'}>{r.metric.phase}</td><td>{r.value}</td></tr>)}</tbody></table>
              ) : <div className="p-4"><Empty>No Kubernetes cluster running.</Empty></div>}
            </Panel>
          </div>
        </>
      ) : <NoProm />}
    </div>
  )
}

function ContainersTable() {
  const { data } = useContainers()
  const [group, setGroup] = useState('all')
  const [showStopped, setShowStopped] = useState(false)
  const list = (data?.containers ?? []).filter((c) => (showStopped || c.state === 'running') && (group === 'all' || c.group === group))
  const groups = [...new Set((data?.containers ?? []).filter((c) => showStopped || c.state === 'running').map((c) => c.group))].sort()
  const maxMem = Math.max(1, ...list.map((c) => c.mem))
  return (
    <Panel title={`Containers (${list.length})`} bodyClass="p-0" action={
      <div className="flex flex-wrap items-center gap-1">
        {['all', ...groups].map((g) => <button key={g} onClick={() => setGroup(g)} className={cn('rounded-full px-2.5 py-0.5 text-xs', group === g ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>{g}</button>)}
        <label className="ml-2 flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={showStopped} onChange={(e) => setShowStopped(e.target.checked)} /> stopped</label>
      </div>}>
      {list.length ? (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-4 py-2">Container</th><th>Kind</th><th className="w-40">CPU</th><th className="w-44">Memory</th><th>Status</th></tr></thead>
            <tbody>
              {list.sort((a, b) => b.mem - a.mem).map((c) => (
                <tr key={c.name} className="border-b border-border/50">
                  <td className="max-w-[340px] truncate px-4 py-2 font-mono text-xs" title={`${c.name}\n${c.image}`}><Dot on={c.state === 'running'} className="mr-2" />{c.name}</td>
                  <td className="text-xs text-muted-foreground">{c.group}</td>
                  <td><div className="flex items-center gap-2 pr-4"><Meter value={c.cpu} className="w-20" /><span className="font-mono text-xs">{c.cpu.toFixed(1)}%</span></div></td>
                  <td><div className="flex items-center gap-2 pr-4"><Meter value={(c.mem / maxMem) * 60} className="w-20" /><span className="font-mono text-xs">{bytes(c.mem)}</span></div></td>
                  <td className="pr-4 text-xs text-muted-foreground">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="p-4"><Empty>No containers.</Empty></div>}
    </Panel>
  )
}
