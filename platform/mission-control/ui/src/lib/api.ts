// Typed client for the panel's Python API (platform/mission-control/server.py).
import { useQuery } from '@tanstack/react-query'

export type StageState = 'up' | 'down' | 'partial' | 'stale'
export type Job = { id: string; target: string; action: string; rc: number | null; started: number; ended: number | null; expected: number | null; step?: string }
export type Run = { id: string; target: string; action: string; rc: number; started: number; ended: number }
export type Stage = {
  id: string; title: string; family: 'aws' | 'gcp' | 'azure'; kind: 'vm' | 'container' | 'k8s' | 'serverless'; emulator: string
  note: string; login: { users: string[]; password: string } | null; state: StageState; since: number; url: string | null
  port: number | null; resources: number; job: Job | null; last: Run | null; loadtest: boolean; loadtest_job: Job | null
}
export type Emulator = { id: string; title: string; cloud: string; port: number; up: boolean; used_by: string[]; job: Job | null; busy: boolean }
export type Status = {
  stages: Stage[]; emulators: Emulator[]; active: Job[]; ci_running: boolean; now: number
  system: { docker: boolean; mem_total: number; mem_used: number; ncpu: number; running: number; groups: Record<string, number> }
  tools: { grafana: boolean; prometheus: boolean; gitea: boolean }
}
export type Address = { address: string; type: string; id: string; name: string }
export type StageDetail = {
  status: Stage; resources: [string, number][]; outputs: Record<string, unknown>; runs: Run[]; commands: Record<string, string>; dir: string
  addresses: Address[]; readme: string
  containers: { shared: boolean; network: string; emulator?: string; items: Container[] }
}
export type Container = { name: string; image: string; state: string; status: string; ports: string; group: string; cpu: number; mem: number; networks?: string[] }
export type CiJob = { id: number; name: string; status: string }
export type CiRun = { id: number; workflow: string; status: string; started: number; stopped: number; jobs: CiJob[] }
export type Ci = { gitea: boolean; runner: boolean; workflows: string[]; runs: CiRun[]; url: string; job: Job | null }
export type JobLog = { id: string; lines: string[]; next: number; rc: number | null; target: string; action: string; started: number; ended: number | null; expected: number | null }

export class ApiError extends Error {
  status: number
  job?: string
  constructor(status: number, message: string, job?: string) {
    super(message)
    this.status = status
    this.job = job
  }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => ({}))).error ?? r.statusText)
  return r.json()
}

// Every state-changing call carries X-Panel: 1 (the server refuses cross-site requests without it).
export async function post(path: string): Promise<{ job?: string }> {
  const r = await fetch(path, { method: 'POST', headers: { 'X-Panel': '1' } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(r.status, body.error ?? r.statusText, body.job)
  return body
}

export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: () => get<Status>('/api/status'), refetchInterval: 3000 })
export const useStage = (id: string) => useQuery({ queryKey: ['stage', id], queryFn: () => get<StageDetail>(`/api/stages/${id}`), refetchInterval: 4000 })
export const useContainers = () => useQuery({ queryKey: ['containers'], queryFn: () => get<{ containers: Container[] }>('/api/containers'), refetchInterval: 5000 })
export const useHistory = () => useQuery({ queryKey: ['history'], queryFn: () => get<Run[]>('/api/history'), refetchInterval: 5000 })
export const useCi = () => useQuery({ queryKey: ['ci'], queryFn: () => get<Ci>('/api/ci'), refetchInterval: 5000 })
export const getLog = (id: string, from: number) => get<JobLog>(`/api/jobs/${id}/log?from=${from}`)
export const useCiJobLog = (id: number | null, live: boolean) => useQuery({
  queryKey: ['ci-log', id], enabled: id !== null, refetchInterval: live ? 3000 : false,
  queryFn: () => get<{ lines: string[]; note: string }>(`/api/ci/jobs/${id}/log`),
})

// ── Prometheus (proxied by the server) ──────────────────────────────────────────────────────────
type PromSeries = { metric: Record<string, string>; values?: [number, string][]; value?: [number, string] }
export type Series = { name: string; points: { t: number; v: number }[] }

export function usePromRange(query: string, label: (m: Record<string, string>) => string, minutes = 30, enabled = true) {
  return useQuery({
    queryKey: ['prom-range', query, minutes],
    enabled,
    refetchInterval: 5000,
    queryFn: async (): Promise<Series[]> => {
      const end = Math.floor(Date.now() / 1000), start = end - minutes * 60, step = Math.max(5, Math.round((minutes * 60) / 150))
      const r = await get<{ status: string; data: { result: PromSeries[] } }>(
        `/api/prom/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&step=${step}`)
      return r.data.result.map((s) => ({ name: label(s.metric), points: (s.values ?? []).map(([t, v]) => ({ t, v: Number(v) })) }))
    },
  })
}

export function usePromInstant(query: string, enabled = true) {
  return useQuery({
    queryKey: ['prom', query],
    enabled,
    refetchInterval: 5000,
    queryFn: async () => (await get<{ data: { result: PromSeries[] } }>(`/api/prom/query?query=${encodeURIComponent(query)}`)).data.result
      .map((s) => ({ metric: s.metric, value: Number(s.value?.[1] ?? 0) })),
  })
}
