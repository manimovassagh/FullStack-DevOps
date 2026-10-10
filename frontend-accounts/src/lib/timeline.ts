import type { Media, Watering } from '@/types'
import { parseDate } from './format'

export type TimelineItem =
  | { kind: 'media'; key: string; date: string; media: Media }
  | { kind: 'water'; key: string; date: string; watering: Watering }

// Merge photos/files and waterings into one story, newest first.
export function buildTimeline(media: Media[], waterings: Watering[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...media.map((m) => ({ kind: 'media' as const, key: `m-${m.id}`, date: m.created_at, media: m })),
    ...waterings.map((w) => ({ kind: 'water' as const, key: `w-${w.id}`, date: w.watered_on, watering: w })),
  ]
  return items.sort((a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime())
}
