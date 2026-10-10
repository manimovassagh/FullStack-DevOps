import { useState } from 'react'
import { ChevronRight, ExternalLink, Play } from 'lucide-react'
import { useCi, useCiJobLog, useStatus, type CiJob, type CiRun } from '@/lib/api'
import { ago, dur, now } from '@/lib/format'
import { useActions } from '@/components/actions'
import { Dot, Empty, Panel } from '@/components/bits'
import { LogView } from '@/components/LogView'
import { Button } from '@/components/ui/button'
import { Loading } from '@/pages/Overview'
import { cn } from '@/lib/utils'

const TONE: Record<string, string> = { success: 'text-emerald-600 dark:text-emerald-400', failure: 'text-red-600 dark:text-red-400', running: 'text-amber-600 dark:text-amber-300', waiting: 'text-muted-foreground', blocked: 'text-muted-foreground', cancelled: 'text-muted-foreground', skipped: 'text-muted-foreground' }

export function Pipelines() {
  const { data: ci } = useCi()
  const { data: s } = useStatus()
  const { run } = useActions()
  const [openRun, setOpenRun] = useState<number | null>(null)
  const [job, setJob] = useState<CiJob | null>(null)
  if (!ci) return <Loading />
  const deploysUp = s?.stages.some((x) => x.state === 'up')
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-gradient text-3xl font-semibold tracking-tight">Pipelines</h1>
          <p className="text-sm text-muted-foreground">The repo's GitHub Actions workflows, run on this machine by Gitea and its runner (local-ci/).</p>
        </div>
        <span className="flex-1" />
        <Button variant="outline" size="sm" asChild><a href={ci.url} target="_blank" rel="noreferrer"><ExternalLink /> Open Gitea</a></Button>
        <Button size="sm" variant={ci.gitea ? 'ghost' : 'default'} disabled={!!ci.job}
          onClick={() => run({ path: `/api/ci/${ci.gitea ? 'down' : 'up'}`, label: 'Local CI', action: ci.gitea ? 'ci-down' : 'ci-up' })}>
          <Dot on={ci.gitea && ci.runner} /> {ci.gitea ? 'Stop local CI' : 'Start local CI'}
        </Button>
      </div>
      <Panel title="Workflows" bodyClass="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ci.workflows.map((wf) => (
          <div key={wf} className="flex items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2">
            <span className="flex-1 font-mono text-sm">{wf}</span>
            <Button size="sm" variant="outline" disabled={!ci.gitea || !!ci.job}
              onClick={() => run({
                path: `/api/ci/run/${wf}`, label: wf, action: 'ci-run',
                confirm: { title: `Run ${wf}?`, action: 'Run pipeline', body: <><p>Pushes your current commit to the local Gitea and runs this workflow there. It builds, deploys to its own Floci, tests and tears down (10–25 min).</p>{deploysUp && <p className="text-amber-600 dark:text-amber-300">Deployments are running here and share Docker ports with the pipeline: tear them down first, or the pipeline will fail.</p>}</> },
              })}><Play /> Run</Button>
          </div>
        ))}
      </Panel>
      <Panel title="Recent runs" bodyClass="p-0">
        {!ci.gitea ? <div className="p-4"><Empty>Local CI is stopped. Start it to see and run pipelines.</Empty></div> : ci.runs.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-4 py-2">#</th><th>Workflow</th><th>Result</th><th>Jobs</th><th>When</th><th>Took</th></tr></thead>
            <tbody>
              {ci.runs.map((r) => (<RunRows key={r.id} r={r} open={openRun === r.id} job={job}
                onToggle={() => { setOpenRun(openRun === r.id ? null : r.id); setJob(null) }} onJob={setJob} />))}
            </tbody>
          </table>
        ) : <div className="p-4"><Empty>No runs yet.</Empty></div>}
      </Panel>
      {job && <JobLog job={job} onClose={() => setJob(null)} />}
    </div>
  )
}

function RunRows({ r, open, job, onToggle, onJob }: { r: CiRun; open: boolean; job: CiJob | null; onToggle: () => void; onJob: (j: CiJob) => void }) {
  return (
    <>
      <tr onClick={onToggle} className={cn('cursor-pointer border-b border-border/50 align-top hover:bg-muted/40', open && 'bg-muted/30')}>
                  <td className="px-4 py-2 font-mono text-xs"><span className="flex items-center gap-1"><ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />{r.id}</span></td>
                  <td className="py-2 font-mono text-xs">{r.workflow}</td>
                  <td className={cn('py-2 font-medium capitalize', TONE[r.status])}>{r.status}</td>
                  <td className="py-2"><div className="flex flex-wrap gap-1">{r.jobs.map((j) => <span key={j.name} title={j.name} className={cn('rounded border px-1.5 py-0.5 text-[11px]', TONE[j.status])}>{j.name.split(' · ')[0]}</span>)}</div></td>
                  <td className="py-2 text-xs text-muted-foreground">{r.started ? ago(r.started) : '—'}</td>
                  <td className="py-2 font-mono text-xs">{r.started ? dur((r.stopped || now()) - r.started) : '—'}</td>
      </tr>
      {open && (
        <tr className="border-b border-border/50 bg-muted/20">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {r.jobs.map((j) => (
                <button key={j.id} onClick={() => onJob(j)}
                  className={cn('card-link relative flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left text-sm', job?.id === j.id && 'brand-selected')}>
                  <span className={cn('text-xs font-semibold capitalize', TONE[j.status])}>{j.status}</span>
                  <span className="min-w-0 flex-1 truncate">{j.name}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Click a job to read its log here.</p>
          </td>
        </tr>
      )}
    </>
  )
}

function JobLog({ job, onClose }: { job: CiJob; onClose: () => void }) {
  const live = job.status === 'running' || job.status === 'waiting'
  const { data } = useCiJobLog(job.id, live)
  return (
    <Panel title={<>{job.name} <span className={cn('ml-2 text-xs font-semibold capitalize', TONE[job.status])}>{job.status}</span></>}
      action={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>} bodyClass="p-0">
      {data?.note && !data.lines.length ? <div className="p-4"><Empty>{data.note}</Empty></div>
        : <LogView lines={data?.lines ?? []} className="h-[60vh] rounded-b-2xl" />}
    </Panel>
  )
}
