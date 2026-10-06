import { Boxes, Cpu, HardDrive, Loader2, Server } from 'lucide-react'
import { Link } from 'react-router'
import { useHistory, usePromRange, useStatus } from '@/lib/api'
import { ago, bytes, dur, now, targetTitle, verb } from '@/lib/format'
import { useActions } from '@/components/actions'
import { Dot, Empty, Kpi, Meter, Panel, StageIcon, StatusBadge, TimeChart } from '@/components/bits'
import { EmulatorStrip } from '@/pages/shared'
import { Button } from '@/components/ui/button'

export function Overview() {
  const { data: s } = useStatus()
  const { data: hist } = useHistory()
  const { openLog } = useActions()
  const groups = usePromRange('sum by (group) (container_up)', (m) => m.group, 30, !!s?.tools.prometheus)
  const cpu = usePromRange('topk(6, container_cpu_percent)', (m) => m.name.replace(/^floci-/, '').slice(0, 34), 30, !!s?.tools.prometheus)
  if (!s) return <Loading />
  const up = s.stages.filter((x) => x.state === 'up')
  const memPct = s.system.mem_total ? (s.system.mem_used / s.system.mem_total) * 100 : 0
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">Everything running in the local cloud lab, live.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Deployments up" icon={Server} value={<>{up.length}<span className="text-lg text-muted-foreground"> / {s.stages.length}</span></>} sub={up.map((x) => x.title).join(', ') || 'Nothing deployed'} tone={up.length ? 'text-emerald-400' : ''} />
        <Kpi label="Containers" icon={Boxes} value={s.system.running} sub={Object.entries(s.system.groups).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(' · ') || '—'} />
        <Kpi label="Docker memory" icon={HardDrive} value={<>{bytes(s.system.mem_used)}<span className="text-lg text-muted-foreground"> / {bytes(s.system.mem_total)}</span></>} sub={`${s.system.ncpu} CPUs`}>
          <Meter value={memPct} className="mt-3" />
        </Kpi>
        <Kpi label="Running now" icon={Cpu} value={s.active.length || 'Idle'} tone={s.active.length ? 'text-amber-300' : 'text-muted-foreground'}
          sub={s.active[0] ? `${verb(s.active[0].action)} ${targetTitle(s.active[0].target, s.stages)} · ${dur(now() - s.active[0].started)}` : 'No job in progress'} />
      </div>
      <EmulatorStrip />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Containers by kind (30 min)">{s.tools.prometheus ? <TimeChart series={groups.data} stacked /> : <NoProm />}</Panel>
        <Panel title="CPU · busiest containers (% of a core)">{s.tools.prometheus ? <TimeChart series={cpu.data} unit="%" /> : <NoProm />}</Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Deployments" action={<Button variant="ghost" size="sm" asChild><Link to="/deployments">All deployments →</Link></Button>} bodyClass="p-2">
          <div className="grid gap-1">
            {s.stages.map((st) => (
              <Link key={st.id} to={`/deployments/${st.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/50">
                <StageIcon stage={st} className="size-8" />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{st.title}</div><div className="truncate text-xs text-muted-foreground">{st.note}</div></div>
                {st.job && <span className="text-xs text-amber-300">{dur(now() - st.job.started)}</span>}
                <StatusBadge stage={st} />
              </Link>
            ))}
          </div>
        </Panel>
        <Panel title="Recent activity" action={<Button variant="ghost" size="sm" asChild><Link to="/activity">Everything →</Link></Button>} bodyClass="p-2">
          {hist?.length ? (
            <div className="grid gap-0.5">
              {hist.slice(0, 12).map((h) => (
                <button key={h.id} onClick={() => openLog(h.id, targetTitle(h.target, s.stages))} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/50">
                  <Dot on={h.rc === 0} className={h.rc === 0 ? '' : 'bg-red-400'} />
                  <span className="min-w-0 flex-1 truncate"><b className="font-medium">{targetTitle(h.target, s.stages)}</b> <span className="text-muted-foreground">{verb(h.action).toLowerCase()}</span></span>
                  <span className="text-xs text-muted-foreground">{dur(h.ended - h.started)} · {ago(h.ended)}</span>
                </button>
              ))}
            </div>
          ) : <Empty>Nothing has run yet. Deploy something!</Empty>}
        </Panel>
      </div>
    </div>
  )
}

export function Loading() {
  return <div className="grid h-64 place-items-center text-muted-foreground"><Loader2 className="size-6 animate-spin" /></div>
}
export function NoProm() {
  return <Empty>Charts need the observability stack (Prometheus). Start it on the Observability page.</Empty>
}
