import { Activity, BarChart3, Boxes, Gauge, GitBranch, LayoutDashboard, LineChart, Loader2, Sprout } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { useStatus } from '@/lib/api'
import { dur, now, targetTitle, verb } from '@/lib/format'
import { useActions } from '@/components/actions'
import { Dot } from '@/components/bits'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/deployments', label: 'Deployments', icon: Boxes },
  { to: '/observability', label: 'Observability', icon: LineChart },
  { to: '/dashboards', label: 'Dashboards', icon: BarChart3 },
  { to: '/loadtests', label: 'Load tests', icon: Gauge },
  { to: '/pipelines', label: 'Pipelines', icon: GitBranch },
  { to: '/activity', label: 'Activity', icon: Activity },
]

export function AppShell() {
  const { data: s, isError } = useStatus()
  const { openLog } = useActions()
  const up = s?.stages.filter((x) => x.state === 'up').length ?? 0
  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-white/[0.06] bg-black/20 backdrop-blur-xl md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-700 text-white shadow-lg shadow-emerald-500/20"><Sprout className="size-5" /></span>
          <div className="leading-tight"><div className="font-semibold">Control panel</div><div className="text-xs text-muted-foreground">Plant Parent cloud lab</div></div>
        </div>
        <nav className="grid gap-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground', isActive && 'bg-gradient-to-r from-emerald-400/15 to-transparent text-foreground ring-1 ring-emerald-400/20')}>
              <Icon className="size-4" /> {label}
              {to === '/deployments' && s && <span className="ml-auto rounded-full bg-emerald-500/15 px-2 text-xs text-emerald-400">{up}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto grid gap-2 border-t p-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2"><Dot on={!!s?.system.docker} /> Docker {s?.system.docker ? `· ${s.system.running} containers` : 'not running'}</div>
          <div className="flex items-center gap-2"><Dot on={!!s?.tools.prometheus} /> Prometheus</div>
          <a href="http://localhost:3400" target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-foreground"><Dot on={!!s?.tools.grafana} /> Grafana ↗</a>
          <a href="http://localhost:3300/ci/FullStack-DevOps/actions" target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-foreground"><Dot on={!!s?.tools.gitea} /> Gitea ↗</a>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/70 px-4 py-3 backdrop-blur md:px-8">
          <nav className="flex gap-1 overflow-x-auto md:hidden">
            {NAV.map(({ to, label, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('rounded-md px-2 py-1 text-sm whitespace-nowrap text-muted-foreground', isActive && 'bg-gradient-to-r from-emerald-400/15 to-transparent text-foreground ring-1 ring-emerald-400/20')}>{label}</NavLink>)}
          </nav>
          <span className="flex-1" />
          {isError && <span className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs text-red-300">Panel server not answering</span>}
          {s?.ci_running && <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">Pipeline running: deploys paused</span>}
          {s?.active.map((j) => (
            <button key={j.id} onClick={() => openLog(j.id, targetTitle(j.target, s.stages))}
              className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200 hover:bg-amber-500/20">
              <Loader2 className="size-3.5 animate-spin" /> {verb(j.action)} · {targetTitle(j.target, s.stages)} · {dur(now() - j.started)}
            </button>
          ))}
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8"><Outlet /></main>
      </div>
    </div>
  )
}
