import { useCallback, useEffect, useState } from 'react'
import { Droplets, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { api, errorMessage } from '@/api'
import { PlantCard, PlantCover } from '@/components/PlantCard'
import { PlantFormDialog } from '@/components/PlantFormDialog'
import { WaterBadge } from '@/components/WaterBadge'
import { Button } from '@/components/ui/button'
import type { NewPlant, PlantSummary } from '@/types'

export function GardenPage() {
  const [plants, setPlants] = useState<PlantSummary[] | null>(null)

  // State is set in promise callbacks, never synchronously, so the effect below
  // doesn't trigger a cascading render (react/set-state-in-effect).
  const load = useCallback(
    () =>
      api.listPlants().then(setPlants, (e: unknown) => {
        toast.error(`Couldn't load your garden: ${errorMessage(e)}`)
        setPlants((prev) => prev ?? [])
      }),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function water(id: string) {
    try {
      const p = await api.waterPlant(id)
      toast.success(`${p.name} says thanks 💧`)
      await load()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function create(p: NewPlant) {
    const created = await api.createPlant(p) // errors surface in the dialog
    toast.success(`${created.name} joined your garden 🌱`)
    await load()
  }

  const thirsty = plants?.filter((p) => p.days_until_water <= 0) ?? []
  const addButton = (
    <Button size="lg">
      <Plus /> Add plant
    </Button>
  )

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Your garden</h1>
          {plants && plants.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              {plants.length} {plants.length === 1 ? 'plant' : 'plants'}
              {thirsty.length > 0 ? ` · ${thirsty.length} thirsty` : ' · everyone is happy'}
            </p>
          )}
        </div>
        <PlantFormDialog title="New plant" trigger={addButton} onSubmit={create} />
      </div>

      {plants === null && <GridSkeleton />}

      {plants?.length === 0 && (
        <div className="grid place-items-center gap-4 rounded-3xl border border-dashed bg-card/60 px-6 py-20 text-center">
          <p className="text-7xl">🪴</p>
          <h2 className="font-heading text-2xl font-semibold">Your garden is empty</h2>
          <p className="max-w-sm text-muted-foreground">Add your first plant to start tracking watering and its growth in photos.</p>
          <PlantFormDialog title="New plant" trigger={addButton} onSubmit={create} />
        </div>
      )}

      {thirsty.length > 0 && (
        <section className="rounded-3xl border border-amber-500/30 bg-amber-500/8 p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold">
            <Droplets className="size-5 text-amber-600 dark:text-amber-400" /> Thirsty now
          </h2>
          <ul className="flex gap-3 overflow-x-auto pb-1">
            {thirsty.map((p) => (
              <li key={p.id} className="flex shrink-0 items-center gap-3 rounded-2xl bg-card p-2 pr-3 shadow-sm ring-1 ring-border">
                <Link to={`/plants/${p.id}`} className="size-12 overflow-hidden rounded-xl">
                  <PlantCover plant={p} />
                </Link>
                <div>
                  <p className="font-medium leading-tight">{p.name}</p>
                  <WaterBadge daysUntil={p.days_until_water} className="mt-1" />
                </div>
                <Button size="icon-sm" onClick={() => water(p.id)} aria-label={`Water ${p.name} now`}>
                  <Droplets />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plants && plants.length > 0 && (
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {plants.map((p) => (
            <PlantCard key={p.id} plant={p} onWater={water} />
          ))}
        </section>
      )}
    </div>
  )
}

function GridSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading plants">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-72 animate-pulse rounded-2xl bg-muted" />
      ))}
    </div>
  )
}
