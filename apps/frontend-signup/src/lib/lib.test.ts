import { describe, expect, it } from 'vitest'
import type { Media, Watering } from '@/types'
import { formatBytes, isInlineImage, parseDate } from './format'
import { buildTimeline } from './timeline'

const media = (id: string, created_at: string): Media => ({
  id, plant_id: 'p', filename: `${id}.png`, content_type: 'image/png', size_bytes: 1, caption: '', created_at,
})
const watering = (id: string, watered_on: string): Watering => ({
  id, plant_id: 'p', watered_on, created_at: `${watered_on}T08:00:00Z`,
})

describe('buildTimeline', () => {
  it('merges media and waterings newest first', () => {
    const items = buildTimeline(
      [media('photo', '2026-09-21T10:00:00Z'), media('old', '2026-09-01T10:00:00Z')],
      [watering('w1', '2026-09-20')],
    )
    expect(items.map((i) => i.key)).toEqual(['m-photo', 'w-w1', 'm-old'])
  })

  it('returns [] for empty inputs', () => {
    expect(buildTimeline([], [])).toEqual([])
  })
})

describe('format helpers', () => {
  it.each([
    [512, '512 B'],
    [1536, '1.5 KB'],
    [2 * 1024 * 1024, '2.0 MB'],
  ])('formatBytes(%i) = %s', (n, s) => expect(formatBytes(n)).toBe(s))

  it('only treats safe raster images as inline', () => {
    expect(isInlineImage('image/webp')).toBe(true)
    expect(isInlineImage('image/svg+xml')).toBe(false)
    expect(isInlineImage('application/pdf')).toBe(false)
  })

  it('parses date-only strings as local dates', () => {
    const d = parseDate('2026-09-20')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 20])
  })
})
