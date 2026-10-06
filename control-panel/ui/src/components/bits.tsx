import type { ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Boxes, Cloud, Cpu, Hexagon, Server, Zap } from 'lucide-react'
import type { Series, Stage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { verb } from '@/lib/format'

export const KIND_ICON = { vm: Server, container: Boxes, k8s: Hexagon, serverless: Zap } as const
export const CLOUD = {
  aws: { name: 'AWS', color: 'bg-orange-400' }, gcp: { name: 'Google Cloud', color: 'bg-blue-400' }, azure: { name: 'Azure', color: 'bg-sky-400' },
} as const
export const KIND_NAME = { vm: 'Virtual machines', container: 'Containers', k8s: 'Kubernetes', serverless: 'Serverless' } as const

export function StageIcon({ stage, className }: { stage: Pick<Stage, 'kind' | 'state'>; className?: string }) {
  const Icon = KIND_ICON[stage.kind] ?? Cloud
  return (
    <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-white/[0.07] to-white/[0.02] ring-1 ring-white/10',
      stage.state === 'up' ? 'from-emerald-400/25 to-cyan-400/10 text-emerald-300 ring-emerald-400/30' : 'text-muted-foreground', className)}>
      <Icon className="size-5" />
    </span>
  )
}

const STATE: Record<string, [string, string]> = {
  up: ['Running', 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'],
  down: ['Stopped', 'border-border bg-muted/50 text-muted-foreground'],
  partial: ['Not answering', 'border-red-500/30 bg-red-500/10 text-red-400'],
  stale: ['Emulator reset', 'border-violet-500/30 bg-violet-500/10 text-violet-300'],
  busy: ['', 'border-amber-500/30 bg-amber-500/10 text-amber-300'],
}
export function StatusBadge({ stage }: { stage: Stage }) {
  const [label, cls] = stage.job ? [verb(stage.job.action), STATE.busy[1]] : STATE[stage.state]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium', cls)}>
      <span className={cn('size-1.5 rounded-full bg-current', stage.job && 'animate-pulse')} />
      {label}
    </span>
  )
}

export function Dot({ on, className }: { on: boolean; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', on ? 'bg-emerald-400 shadow-[0_0_0_3px] shadow-emerald-400/20' : 'bg-muted-foreground/40', className)} />
}

export function Panel({ title, action, children, className, bodyClass }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn('glass rounded-2xl', className)}>
      {(title || action) && (
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="flex-1" />
          {action}
        </header>
      )}
      <div className={cn('p-4', bodyClass)}>{children}</div>
    </section>
  )
}

export function Kpi({ label, value, sub, icon: Icon = Cpu, tone = 'text-foreground', children, spark }: { label: string; value: ReactNode; sub?: ReactNode; icon?: typeof Cpu; tone?: string; children?: ReactNode; spark?: Series }) {
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"><Icon className="size-3.5" /> {label}</div>
      <div className={cn('mt-2 text-3xl font-semibold tabular-nums tracking-tight', tone)}>{value}</div>
      {sub && <div className="mt-1 truncate text-sm text-muted-foreground">{sub}</div>}
      {children}
      {spark && spark.points.length > 1 && (
        <div className="pointer-events-none -mx-4 -mb-4 mt-3 h-12 opacity-80">
          <ResponsiveContainer><AreaChart data={spark.points}><defs><linearGradient id={`g-${label}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.35} /><stop offset="100%" stopColor="#34d399" stopOpacity={0} /></linearGradient></defs><Area dataKey="v" type="monotone" stroke="#34d399" strokeWidth={1.4} fill={`url(#g-${label})`} isAnimationActive={false} /></AreaChart></ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export function Meter({ value, className }: { value: number; className?: string }) {
  const tone = value > 85 ? 'bg-red-400' : value > 65 ? 'bg-amber-400' : 'bg-emerald-400'
  return <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}><div className={cn('h-full rounded-full transition-all duration-500', tone)} style={{ width: `${Math.min(100, value)}%` }} /></div>
}

const PALETTE = ['#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb923c', '#a3e635', '#f87171', '#e879f9']
export function TimeChart({ series, unit = '', stacked = false, height = 220, empty = 'No data yet' }: { series: Series[] | undefined; unit?: string; stacked?: boolean; height?: number; empty?: string }) {
  if (!series?.length || series.every((s) => !s.points.length)) {
    return <div className="grid place-items-center rounded-xl border border-dashed text-sm text-muted-foreground" style={{ height }}>{empty}</div>
  }
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b)
  const data = times.map((t) => Object.fromEntries([['t', t], ...series.map((s) => [s.name, s.points.find((p) => p.t === t)?.v ?? null])]))
  const fmt = (v: number) => unit === 'bytes' ? (v >= 1024 ** 3 ? `${(v / 1024 ** 3).toFixed(1)}G` : `${Math.round(v / 1024 ** 2)}M`)
    : unit === 's' ? (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(1)}s`) : unit === '%' ? `${v.toFixed(v < 10 ? 1 : 0)}%`
    : unit === 'ratio' ? `${(v * 100).toFixed(1)}%` : `${Math.round(v * 10) / 10}${unit}`
  const time = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
      <XAxis dataKey="t" tickFormatter={time} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="transparent" minTickGap={40} />
      <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="transparent" width={52} />
      <Tooltip labelFormatter={(t) => time(Number(t))} formatter={(v) => fmt(Number(v))}
        contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
    </>
  )
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        {stacked ? (
          <AreaChart data={data}>{common}{series.map((s, i) => <Area key={s.name} dataKey={s.name} stackId="a" type="monotone" stroke={PALETTE[i % 10]} fill={PALETTE[i % 10]} fillOpacity={0.25} strokeWidth={1.5} isAnimationActive={false} connectNulls />)}</AreaChart>
        ) : (
          <LineChart data={data}>{common}{series.map((s, i) => <Line key={s.name} dataKey={s.name} type="monotone" stroke={PALETTE[i % 10]} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />)}</LineChart>
        )}
      </ResponsiveContainer>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {series.slice(0, 10).map((s, i) => <span key={s.name} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 rounded-sm" style={{ background: PALETTE[i % 10] }} />{s.name}</span>)}
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>
}
