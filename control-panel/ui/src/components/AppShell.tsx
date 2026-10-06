import { Activity, BarChart3, Boxes, ExternalLink, Flame, Gauge, GitBranch, LayoutDashboard, LineChart, Loader2, Moon, Sprout, Sun, Workflow } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Link, NavLink, Outlet } from 'react-router'
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

const TOOLS = [
  { key: 'grafana', label: 'Grafana', icon: BarChart3, url: 'http://localhost:3400/d/stacks-overview', hint: 'Dashboards over Prometheus' },
  { key: 'prometheus', label: 'Prometheus', icon: Flame, url: 'http://localhost:9091/query', hint: 'Query the raw metrics' },
  { key: 'gitea', label: 'Local CI (Gitea)', icon: Workflow, url: 'http://localhost:3300/ci/FullStack-DevOps/actions', hint: 'The pipelines, run on this machine' },
] as const

function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  return (
    <button onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="order-last grid size-9 place-items-center rounded-full border bg-card/70 text-muted-foreground shadow-sm transition-colors hover:text-foreground">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}

export function AppShell() {
  const { data: s, isError } = useStatus()
  const { openLog } = useActions()
  const up = s?.stages.filter((x) => x.state === 'up').length ?? 0
  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r bg-white/55 backdrop-blur-xl md:flex dark:bg-black/15">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-700 text-white shadow-lg shadow-emerald-500/20"><Sprout className="size-5" /></span>
          <div className="leading-tight"><div className="font-semibold">Control panel</div><div className="text-xs text-muted-foreground">Plant Parent cloud lab</div></div>
        </div>
        <nav className="grid gap-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground', isActive && 'bg-gradient-to-r from-emerald-400/15 to-transparent text-foreground ring-1 ring-emerald-400/20')}>
              <Icon className="size-4" /> {label}
              {to === '/deployments' && s && <span className="ml-auto rounded-full bg-emerald-500/15 px-2 text-xs text-emerald-600 dark:text-emerald-400">{up}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-6 px-3">
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tools</div>
          {TOOLS.map((t) => {
            const on = !!s?.tools[t.key]
            const cls = 'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground'
            const inner = <><t.icon className="size-4" /> {t.label}<span className="ml-auto flex items-center gap-2">{!on && <span className="text-[10px] uppercase tracking-wide">off</span>}<Dot on={on} />{on && <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />}</span></>
            // A tool that is off opens the page that can start it, not a dead tab.
            return on
              ? <a key={t.key} href={t.url} target="_blank" rel="noreferrer" title={t.hint} className={cls}>{inner}</a>
              : <Link key={t.key} to={t.key === 'gitea' ? '/pipelines' : '/dashboards'} title={`${t.label} is not running: start it here`} className={cls}>{inner}</Link>
          })}
        </div>
        <div className="mt-auto border-t p-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2"><Dot on={!!s?.system.docker} /> Docker {s?.system.docker ? `· ${s.system.running} containers` : 'not running'}</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/70 px-4 py-3 backdrop-blur md:px-8">
          <nav className="flex gap-1 overflow-x-auto md:hidden">
            {NAV.map(({ to, label, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('rounded-md px-2 py-1 text-sm whitespace-nowrap text-muted-foreground', isActive && 'bg-gradient-to-r from-emerald-400/15 to-transparent text-foreground ring-1 ring-emerald-400/20')}>{label}</NavLink>)}
          </nav>
          <span className="flex-1" />
          {isError && <span className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs text-red-700 dark:text-red-300">Panel server not answering</span>}
          {s?.ci_running && <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-600 dark:text-amber-300">Pipeline running: deploys paused</span>}
          <ThemeSwitch />
          {s?.active.map((j) => (
            <button key={j.id} onClick={() => openLog(j.id, targetTitle(j.target, s.stages))}
              className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-200 hover:bg-amber-500/20">
              <Loader2 className="size-3.5 animate-spin" /> {verb(j.action)} · {targetTitle(j.target, s.stages)} · {dur(now() - j.started)}
            </button>
          ))}
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8"><Outlet /></main>
      </div>
    </div>
  )
}
