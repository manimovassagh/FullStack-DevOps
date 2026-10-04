import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, session, setAccessToken } from './api'

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('api', () => {
  it('lists plants from /api/plants', async () => {
    const fetch = mockFetch(200, [{ id: '1', name: 'Monstera' }])
    await expect(api.listPlants()).resolves.toEqual([{ id: '1', name: 'Monstera' }])
    expect(fetch.mock.calls[0][0]).toBe('/api/plants')
  })

  it('sends JSON when creating a plant', async () => {
    const fetch = mockFetch(201, { id: '1' })
    await api.createPlant({ name: 'Basil', water_every_days: 2 })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/plants')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ name: 'Basil', water_every_days: 2 })
  })

  it('throws ApiError with the server error message', async () => {
    mockFetch(400, { error: 'name is required' })
    const err = await api.createPlant({ name: '', water_every_days: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(400)
    expect(err.message).toBe('name is required')
  })

  it('resolves to undefined on 204 No Content', async () => {
    mockFetch(204)
    await expect(api.deletePlant('1')).resolves.toBeUndefined()
  })

  it('waters a plant with an optional date', async () => {
    const fetch = mockFetch(200, { id: '1' })
    await api.waterPlant('1', '2026-09-20')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/plants/1/water')
    expect(JSON.parse(init.body)).toEqual({ watered_on: '2026-09-20' })
  })

  it('uploads media as multipart form data', async () => {
    const fetch = mockFetch(201, { id: 'm1' })
    const file = new File(['leaf'], 'leaf.png', { type: 'image/png' })
    await api.uploadMedia('p1', file, 'new leaf!')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/plants/p1/media')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
    expect((init.body as FormData).get('caption')).toBe('new leaf!')
  })

  it('sends the access token as a bearer header', async () => {
    const fetch = mockFetch(200, [])
    setAccessToken('TOKEN')
    await api.listPlants()
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer TOKEN')
    setAccessToken(null)
  })

  it('refreshes the session once on a 401 and retries with the new token', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'expired' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'NEW', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fn)
    setAccessToken('OLD')
    await expect(api.listPlants()).resolves.toEqual([])
    expect(fn.mock.calls[1][0]).toBe('/api/auth/refresh')
    expect(new Headers(fn.mock.calls[2][1].headers).get('Authorization')).toBe('Bearer NEW')
    setAccessToken(null)
  })

  it('reports a failed sign-in with the server message', async () => {
    mockFetch(401, { error: 'invalid username or password' })
    const err = await session.login('a', 'b').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('invalid username or password')
  })
})
