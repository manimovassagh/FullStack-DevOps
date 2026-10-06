import { useState } from 'react'
import { useHistory, useStatus } from '@/lib/api'
import { ago, dur, targetTitle, verb } from '@/lib/format'
import { useActions } from '@/components/actions'
import { Empty, Panel } from '@/components/bits'
import { cn } from '@/lib/utils'

export function Activity() {
  const { data: hist } = useHistory()
  const { data: s } = useStatus()
  const { openLog } = useActions()
  const [only, setOnly] = useState<'all' | 'failed'>('all')
  const list = (hist ?? []).filter((h) => only === 'all' || h.rc !== 0)
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-gradient text-3xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">Every deploy, test, release, load test and pipeline the panel ran, with its full log.</p>
      </div>
      <div className="flex gap-2">
        {(['all', 'failed'] as const).map((f) => <button key={f} onClick={() => setOnly(f)} className={cn('rounded-full border px-3 py-1 text-sm capitalize', only === f ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground')}>{f}</button>)}
      </div>
      <Panel bodyClass="p-0">
        {list.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-4 py-2">Result</th><th>What</th><th>Action</th><th>When</th><th>Took</th></tr></thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.id} onClick={() => openLog(h.id, `${targetTitle(h.target, s?.stages)} · ${verb(h.action)}`)} className="cursor-pointer border-b border-border/50 hover:bg-muted/40">
                  <td className={cn('px-4 py-2 font-medium', h.rc === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>{h.rc === 0 ? '✓ ok' : `✗ exit ${h.rc}`}</td>
                  <td>{targetTitle(h.target, s?.stages)}</td>
                  <td className="text-muted-foreground">{verb(h.action)}</td>
                  <td className="text-xs text-muted-foreground">{new Date(h.started * 1000).toLocaleString()} · {ago(h.ended)}</td>
                  <td className="pr-4 font-mono text-xs">{dur(h.ended - h.started)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="p-4"><Empty>Nothing yet.</Empty></div>}
      </Panel>
    </div>
  )
}
