import type { ReactNode } from 'react'
import { ExternalLink, FlaskConical, Gauge, Play, RefreshCw, Square, Eraser, ScrollText } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Stage, Status } from '@/lib/api'
import { useActions } from '@/components/actions'
import { Button } from '@/components/ui/button'

// The buttons a stage offers depend on its state; the same set is used on the card and the detail page.
export function useStageActions(stage: Stage, status: Status | undefined) {
  const { run, openLog } = useActions()
  const navigate = useNavigate()
  const emulatorBusy = status?.emulators.find((e) => e.id === stage.emulator)?.busy
  const blocked = !!(status?.ci_running || emulatorBusy || stage.job)
  const why = status?.ci_running ? 'A pipeline is using Docker right now' : emulatorBusy ? 'Another deployment is running on the same emulator' : undefined
  const go = (action: string, extra: Partial<Parameters<typeof run>[0]> = {}) =>
    run({ path: `/api/stages/${stage.id}/${action}`, label: stage.title, action, ...extra })

  const start = () => go('start', stage.state === 'stale' ? {
    confirm: { title: `Redeploy ${stage.title}?`, action: 'Clear and deploy', body: <p>Its emulator was restarted and lost the resources this stage had. The panel clears the old Terraform state and deploys it again from scratch.</p> },
  } : {})
  const stop = () => go('stop', {
    confirm: { title: `Tear down ${stage.title}?`, action: 'Tear down', danger: true,
      body: <><p>Runs <code className="rounded bg-muted px-1">terraform destroy</code>: its {stage.resources} cloud resources (network, database, services…) are deleted.</p><p>You can deploy it again any time.</p></> },
  })
  const forget = () => go('forget', { confirm: { title: `Clear ${stage.title}'s state?`, action: 'Clear state', body: <p>Use this when the emulator lost everything: the Terraform state file is removed so the next deploy starts clean. Nothing in the emulator is touched.</p> } })

  const primary: ReactNode = stage.job
    ? <Button variant="outline" onClick={() => openLog(stage.job!.id, stage.title)}><ScrollText /> Watch log</Button>
    : stage.state === 'up' && stage.url
      ? <Button asChild className="bg-sky-500/15 text-sky-700 dark:text-sky-300 hover:bg-sky-500/25"><a href={stage.url} target="_blank" rel="noreferrer"><ExternalLink /> Open app</a></Button>
      : stage.state === 'partial'
        ? <Button onClick={start} disabled={blocked} title={why}><RefreshCw /> Retry deploy</Button>
        : <Button onClick={start} disabled={blocked} title={why}><Play /> {stage.state === 'stale' ? 'Redeploy' : 'Deploy'}</Button>

  const secondary = [
    { key: 'test', icon: FlaskConical, label: 'Run smoke tests', onClick: () => go('smoke', { openLog: true }), disabled: blocked || stage.state !== 'up' },
    { key: 'release', icon: RefreshCw, label: 'Release a new version (rollout)', onClick: () => go('rollout', { openLog: true }), disabled: blocked || stage.state !== 'up' },
    { key: 'load', icon: Gauge, label: 'Load test', onClick: () => navigate(`/loadtests?stage=${stage.id}`), disabled: !stage.loadtest || stage.state !== 'up' },
    ...(stage.state === 'partial' || stage.state === 'stale' ? [{ key: 'forget', icon: Eraser, label: 'Clear state', onClick: forget, disabled: blocked }] : []),
    { key: 'stop', icon: Square, label: 'Tear down', onClick: stop, disabled: blocked || stage.state === 'down', danger: true },
  ]
  return { primary, secondary, blocked, why }
}
