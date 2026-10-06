// Every button that changes something goes through here: a proper confirmation dialog, a toast that follows the
// job until it ends, and the log drawer. No browser alert()/confirm().
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Ban, Copy, Search, X } from 'lucide-react'
import { ApiError, getLog, post, type JobLog } from '@/lib/api'
import { DONE, dur, now, verb } from '@/lib/format'
import { LogView } from '@/components/LogView'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

type Confirm = { title: string; body: ReactNode; action: string; danger?: boolean }
type RunOpts = { path: string; label: string; action: string; confirm?: Confirm; openLog?: boolean }
type Ctx = { run: (o: RunOpts) => Promise<void>; openLog: (job: string, title?: string) => void }
const ActionsContext = createContext<Ctx | null>(null)
export const useActions = () => {
  const c = useContext(ActionsContext)
  if (!c) throw new Error('useActions outside <ActionsProvider>')
  return c
}

export function ActionsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [ask, setAsk] = useState<(Confirm & { resolve: (ok: boolean) => void }) | null>(null)
  const [drawer, setDrawer] = useState<{ job: string; title: string } | null>(null)

  const confirm = (c: Confirm) => new Promise<boolean>((resolve) => setAsk({ ...c, resolve }))

  const follow = useCallback((job: string, label: string, action: string) => {
    const id = toast.loading(`${verb(action)} · ${label}`, {
      description: 'Running…', duration: Infinity,
      action: { label: 'Log', onClick: () => setDrawer({ job, title: label }) },
    })
    let from = 0
    const tick = async () => {
      try {
        const j = await getLog(job, from)
        from = j.next
        if (j.rc === null) {
          const last = [...j.lines].reverse().find((l) => l.trim() && !l.startsWith('$ ')) ?? ''
          toast.loading(`${verb(action)} · ${label}`, { id, description: `${dur(now() - j.started)} · ${last.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 90)}` })
          setTimeout(tick, 1500)
          return
        }
        qc.invalidateQueries()
        const t = dur((j.ended ?? now()) - j.started)
        if (j.rc === 0) toast.success(`${label} ${DONE[action] ?? 'done'}`, { id, description: `Finished in ${t}`, duration: 8000, action: { label: 'Log', onClick: () => setDrawer({ job, title: label }) } })
        else toast.error(`${label}: ${verb(action).toLowerCase()} failed`, { id, description: `Exit ${j.rc} after ${t}. Open the log to see why.`, duration: 20000, action: { label: 'Open log', onClick: () => setDrawer({ job, title: label }) } })
      } catch {
        setTimeout(tick, 3000)
      }
    }
    void tick()
  }, [qc])

  const run = useCallback(async (o: RunOpts) => {
    if (o.confirm && !(await confirm(o.confirm))) return
    try {
      const { job } = await post(o.path)
      qc.invalidateQueries()
      if (job) {
        follow(job, o.label, o.action)
        if (o.openLog) setDrawer({ job, title: o.label })
      }
    } catch (e) {
      const err = e as ApiError
      toast.error('Could not start', { description: err.message, action: err.job ? { label: 'See what is running', onClick: () => setDrawer({ job: err.job!, title: 'Running job' }) } : undefined })
    }
  }, [qc, follow])

  return (
    <ActionsContext.Provider value={{ run, openLog: (job, title = 'Log') => setDrawer({ job, title }) }}>
      {children}
      <AlertDialog open={!!ask} onOpenChange={(open) => { if (!open && ask) { ask.resolve(false); setAsk(null) } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
            <AlertDialogDescription asChild><div className="space-y-2 text-sm text-muted-foreground">{ask?.body}</div></AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { ask?.resolve(false); setAsk(null) }}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant={ask?.danger ? 'destructive' : 'default'} onClick={() => { ask?.resolve(true); setAsk(null) }}>{ask?.action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {drawer && <LogDrawer job={drawer.job} title={drawer.title} onClose={() => setDrawer(null)} />}
    </ActionsContext.Provider>
  )
}

// Right-hand drawer with the live output of a job.
export function LogDrawer({ job, title, onClose }: { job: string; title: string; onClose: () => void }) {
  const [log, setLog] = useState<JobLog | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const from = useRef(0)
  useEffect(() => {
    let alive = true
    from.current = 0
    setLines([])
    const tick = async () => {
      try {
        const j = await getLog(job, from.current)
        if (!alive) return
        from.current = j.next
        setLog(j)
        if (j.lines.length) setLines((prev) => [...prev, ...j.lines])
        if (j.rc === null) setTimeout(tick, 1000)
      } catch {
        if (alive) setTimeout(tick, 2000)
      }
    }
    void tick()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => { alive = false; window.removeEventListener('keydown', esc) }
  }, [job, onClose])

  const running = log?.rc === null
  const elapsed = log ? (log.ended ?? now()) - log.started : 0
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-4xl flex-col border-l bg-background shadow-2xl animate-in slide-in-from-right duration-200">
        <header className="flex items-center gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            <p className="text-xs text-muted-foreground">
              {log ? `${verb(log.action)} · ${running ? `running ${dur(elapsed)}` : log.rc === 0 ? `finished in ${dur(elapsed)}` : `failed (exit ${log.rc}) after ${dur(elapsed)}`}` : 'loading…'}
            </p>
          </div>
          <span className="flex-1" />
          {running && <Button variant="destructive" size="sm" onClick={async () => { await post(`/api/jobs/${job}/cancel`).catch(() => {}); toast('Cancelling…') }}><Ban /> Cancel</Button>}
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '')); toast.success('Log copied') }}><Copy /> Copy</Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X /></Button>
        </header>
        {running && log?.expected ? (
          <div className="h-1 bg-muted"><div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.min(97, (elapsed / log.expected) * 100)}%` }} /></div>
        ) : null}
        <div className="flex items-center gap-2 border-b bg-muted/30 px-5 py-2">
          <Search className="size-4 text-muted-foreground" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter lines…" className="w-full bg-transparent text-sm outline-none" />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{lines.length} lines</span>
        </div>
        <LogView lines={lines} filter={filter} className="flex-1" />
      </aside>
    </div>
  )
}
