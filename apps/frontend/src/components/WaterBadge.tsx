import { Droplet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { waterStatus, type WaterTone } from '@/lib/water'

const TONE: Record<WaterTone, string> = {
  overdue: 'bg-red-500/12 text-red-700 ring-red-500/30 dark:text-red-300',
  today: 'bg-amber-500/15 text-amber-800 ring-amber-500/35 dark:text-amber-300',
  soon: 'bg-sky-500/12 text-sky-700 ring-sky-500/30 dark:text-sky-300',
  ok: 'bg-emerald-500/12 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
}

export function WaterBadge({ daysUntil, className }: { daysUntil: number; className?: string }) {
  const status = waterStatus(daysUntil)
  return (
    <Badge variant="outline" className={cn('gap-1 border-0 ring-1', TONE[status.tone], className)}>
      <Droplet className={cn('size-3', status.tone !== 'ok' && 'fill-current')} />
      {status.label}
    </Badge>
  )
}
