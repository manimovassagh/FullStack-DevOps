export const now = () => Date.now() / 1000
export function dur(s: number) {
  s = Math.max(0, Math.round(s))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
export function ago(t: number) {
  const s = Math.max(0, now() - t)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
export function bytes(b: number) {
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KiB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MiB`
  return `${(b / 1024 ** 3).toFixed(1)} GiB`
}
export const pct = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}%`

// Human names for what the panel runs.
export const VERB: Record<string, string> = {
  start: 'Deploying', stop: 'Tearing down', smoke: 'Testing', rollout: 'Releasing', forget: 'Clearing state',
  'emu-start': 'Starting emulator', 'emu-stop': 'Stopping emulator', 'ci-up': 'Starting CI', 'ci-down': 'Stopping CI', 'ci-run': 'Running pipeline',
  'obs-up': 'Starting observability', 'obs-down': 'Stopping observability',
  'loadtest-smoke': 'Load test · smoke', 'loadtest-load': 'Load test · load', 'loadtest-spike': 'Load test · spike', 'loadtest-stress': 'Load test · stress',
}
export const DONE: Record<string, string> = {
  start: 'is deployed', stop: 'was torn down', smoke: 'passed its tests', rollout: 'released a new version', forget: 'state cleared',
  'emu-start': 'emulator started', 'emu-stop': 'emulator stopped', 'ci-up': 'CI is running', 'ci-down': 'CI stopped', 'ci-run': 'pipeline passed',
  'obs-up': 'observability is running', 'obs-down': 'observability stopped',
}
export const verb = (a: string) => VERB[a] ?? a
export function targetTitle(target: string, stages: { id: string; title: string }[] = []) {
  const [kind, id] = target.includes(':') ? target.split(':') : ['stage', target]
  const stage = stages.find((s) => s.id === (id ?? target))
  if (kind === 'emu') return `Emulator ${id}`
  if (kind === 'loadtest') return stage?.title ?? id
  if (kind === 'ci') return id ? `Pipeline ${id}` : 'Local CI'
  if (target === 'observability') return 'Observability'
  return stage?.title ?? target
}
