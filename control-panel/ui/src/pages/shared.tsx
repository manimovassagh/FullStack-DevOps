import { Copy, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { useStatus, type Stage } from '@/lib/api'
import { verb } from '@/lib/format'
import { useActions } from '@/components/actions'
import { useStageActions } from '@/components/stageActions'
import { CLOUD, Dot } from '@/components/bits'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function EmulatorStrip() {
  const { data: s } = useStatus()
  const { run } = useActions()
  if (!s) return null
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {s.emulators.map((e) => (
        <div key={e.id} className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
          <Dot on={e.up} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium"><span className={cn('size-2 rounded-sm', CLOUD[e.cloud as keyof typeof CLOUD]?.color)} />{e.title}</div>
            <div className="truncate text-xs text-muted-foreground">:{e.port} · {e.used_by.length > 2 ? `${e.used_by.length} stages` : e.used_by.join(', ')}</div>
          </div>
          {e.job ? <span className="text-xs text-amber-600 dark:text-amber-300">{verb(e.job.action)}…</span> : (
            <Button size="sm" variant={e.up ? 'ghost' : 'outline'} disabled={e.busy || s.ci_running}
              onClick={() => run({
                path: `/api/emulators/${e.id}/${e.up ? 'stop' : 'start'}`, label: e.title, action: e.up ? 'emu-stop' : 'emu-start',
                confirm: e.up ? { title: `Stop ${e.title}?`, action: 'Stop emulator', danger: true, body: <p>Every deployment on it ({e.used_by.join(', ')}) loses its resources. Their state files stay behind; the panel spots that and clears them on the next deploy.</p> } : undefined,
              })}>{e.up ? 'Stop' : 'Start'}</Button>
          )}
        </div>
      ))}
    </div>
  )
}

export function StageButtons({ stage, compact = false }: { stage: Stage; compact?: boolean }) {
  const { data: status } = useStatus()
  const { primary, secondary, why } = useStageActions(stage, status)
  return (
    <div className="flex flex-wrap items-center gap-2" title={why}>
      {primary}
      <span className="flex-1" />
      {secondary.map((b) => (
        <Button key={b.key} variant={'danger' in b && b.danger ? 'destructive' : 'outline'} size={compact ? 'icon' : 'sm'} onClick={b.onClick} disabled={b.disabled} title={b.label} aria-label={b.label}>
          <b.icon />{!compact && <span>{b.label.split(' (')[0]}</span>}
        </Button>
      ))}
    </div>
  )
}

export function LoginHint({ stage }: { stage: Stage }) {
  if (!stage.login) return null
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-3 py-2 text-xs">
      <KeyRound className="size-3.5 text-muted-foreground" />
      <span className="truncate font-mono">{stage.login.users[0]}</span>
      <span className="flex-1" />
      <Button size="xs" variant="ghost" onClick={() => { navigator.clipboard.writeText(stage.login!.password); toast.success('Password copied', { description: `Sign in as ${stage.login!.users.join(', ')}` }) }}><Copy /> password</Button>
    </div>
  )
}
