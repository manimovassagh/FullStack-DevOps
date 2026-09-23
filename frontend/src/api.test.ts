import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

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
    expect(fetch).toHaveBeenCalledWith('/api/plants', undefined)
  })

  it('sends JSON when creating a plant', async () => {
    const fetch = mockFetch(201, { id: '1' })
    await api.createPlant({ name: 'Basil', water_every_days: 2 })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/plants')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
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

  it('builds media URLs', () => {
    expect(api.mediaUrl('abc')).toBe('/api/media/abc')
  })
})
