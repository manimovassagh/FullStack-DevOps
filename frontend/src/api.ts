import type { Media, NewPlant, Plant, PlantDetail, PlantPatch, PlantSummary } from './types'

// All calls use relative /api paths: Vite proxies them in dev, the ALB routes them in prod.
const BASE = '/api'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // error body wasn't JSON; keep the status text
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  listPlants: () => request<PlantSummary[]>('/plants'),
  getPlant: (id: string) => request<PlantDetail>(`/plants/${id}`),
  createPlant: (p: NewPlant) => request<Plant>('/plants', json('POST', p)),
  updatePlant: (id: string, p: PlantPatch) => request<Plant>(`/plants/${id}`, json('PATCH', p)),
  deletePlant: (id: string) => request<void>(`/plants/${id}`, { method: 'DELETE' }),
  waterPlant: (id: string, wateredOn?: string) =>
    request<Plant>(`/plants/${id}/water`, json('POST', wateredOn ? { watered_on: wateredOn } : {})),

  uploadMedia: (plantId: string, file: File, caption?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (caption) form.append('caption', caption)
    // No Content-Type header: the browser sets multipart/form-data with the boundary.
    return request<Media>(`/plants/${plantId}/media`, { method: 'POST', body: form })
  },
  deleteMedia: (id: string) => request<void>(`/media/${id}`, { method: 'DELETE' }),
  mediaUrl: (id: string) => `${BASE}/media/${id}`,
}
