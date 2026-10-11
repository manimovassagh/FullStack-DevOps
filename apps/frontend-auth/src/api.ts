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

// The access token lives in memory only: a page reload signs in again through the HttpOnly
// refresh cookie, so nothing a script could steal is ever written to storage.
let accessToken: string | null = null
let onSignedOut: () => void = () => {}

export const setAccessToken = (t: string | null) => {
  accessToken = t
}
export const setSignedOutHandler = (fn: () => void) => {
  onSignedOut = fn
}

function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(`${BASE}${path}`, { ...init, headers })
}

// One refresh at a time: several requests that hit an expired token share it.
let refreshing: Promise<boolean> | null = null
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST' })
      if (!res.ok) return false
      accessToken = ((await res.json()) as TokenResponse).access_token
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

// fetchAuthed sends the bearer token; on 401 it refreshes the session once and retries.
async function fetchAuthed(path: string, init?: RequestInit): Promise<Response> {
  let res = await send(path, init)
  if (res.status === 401 && (await refreshSession())) res = await send(path, init)
  if (res.status === 401) {
    accessToken = null
    onSignedOut()
  }
  return res
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchAuthed(path, init)
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

export type TokenResponse = { access_token: string; expires_in: number }
export type Me = { id: string; username: string; admin: boolean }

export const session = {
  async login(username: string, password: string): Promise<void> {
    const res = await fetch(`${BASE}/auth/login`, { ...json('POST', { username, password }) })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new ApiError(res.status, body?.error ?? 'Sign-in failed')
    }
    accessToken = ((await res.json()) as TokenResponse).access_token
  },
  async logout(): Promise<void> {
    await fetch(`${BASE}/auth/logout`, { method: 'POST' }).catch(() => undefined)
    accessToken = null
  },
  me: () => request<Me>('/auth/me'),
}

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
  // <img src> cannot send an Authorization header, so photos are fetched with it and shown from a blob URL.
  mediaBlobUrl: async (id: string): Promise<string> => {
    const res = await fetchAuthed(`/media/${id}`)
    if (!res.ok) throw new ApiError(res.status, 'Could not load the file')
    return URL.createObjectURL(await res.blob())
  },
}
