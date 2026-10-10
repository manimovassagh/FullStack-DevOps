import { useState } from 'react'
import { Droplets, Images, Sprout } from 'lucide-react'
import { Link } from 'react-router'
import { AuthImage } from '@/components/AuthImage'
import { WaterBadge } from '@/components/WaterBadge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { PlantSummary } from '@/types'

interface Props {
  plant: PlantSummary
  onWater: (id: string) => Promise<void>
}

export function PlantCard({ plant, onWater }: Props) {
  const [watering, setWatering] = useState(false)
  const thirsty = plant.days_until_water <= 0

  async function water() {
    setWatering(true)
    try {
      await onWater(plant.id)
    } finally {
      setWatering(false)
    }
  }

  return (
    <Card className="group relative gap-0 overflow-hidden p-0 transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10">
      <div className="relative aspect-[4/3] overflow-hidden">
        <PlantCover plant={plant} />
        {plant.media_count > 0 && (
          <span className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-xs text-white backdrop-blur">
            <Images className="size-3" /> {plant.media_count}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-3 p-4">
        <div className="min-w-0">
          {/* Stretched link: the whole card is clickable, but the Water button stays a separate control. */}
          <Link
            to={`/plants/${plant.id}`}
            className="font-heading text-lg font-semibold tracking-tight after:absolute after:inset-0 focus-visible:outline-none"
          >
            {plant.name}
          </Link>
          <p className="truncate text-sm text-muted-foreground">
            {[plant.species, plant.location].filter(Boolean).join(' · ') || 'Mystery plant'}
          </p>
          <WaterBadge daysUntil={plant.days_until_water} className="mt-2" />
        </div>
        <Button
          size="sm"
          variant={thirsty ? 'default' : 'secondary'}
          className="relative z-10 shrink-0"
          disabled={watering}
          onClick={water}
          aria-label={`Water ${plant.name}`}
        >
          <Droplets />
          Water
        </Button>
      </div>
    </Card>
  )
}

export function PlantCover({ plant, className }: { plant: Pick<PlantSummary, 'name' | 'cover_media_id'>; className?: string }) {
  if (plant.cover_media_id) {
    return (
      <AuthImage
        mediaId={plant.cover_media_id}
        alt={plant.name}
        className={`size-full object-cover transition duration-500 group-hover:scale-105 ${className ?? ''}`}
      />
    )
  }
  return (
    <div
      className={`grid size-full place-items-center bg-gradient-to-br from-emerald-200 via-lime-100 to-teal-200 dark:from-emerald-900 dark:via-emerald-950 dark:to-teal-900 ${className ?? ''}`}
    >
      <Sprout className="size-14 text-emerald-600/60 transition duration-500 group-hover:scale-110 group-hover:rotate-6 dark:text-emerald-400/50" />
    </div>
  )
}
