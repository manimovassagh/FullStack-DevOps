import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, Droplets, MapPin, Pencil, Repeat, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { api, ApiError, errorMessage } from '@/api'
import { AuthImage } from '@/components/AuthImage'
import { MediaDropzone } from '@/components/MediaDropzone'
import { PlantCover } from '@/components/PlantCard'
import { PlantFormDialog } from '@/components/PlantFormDialog'
import { Timeline } from '@/components/Timeline'
import { WaterBadge } from '@/components/WaterBadge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { formatDate, isInlineImage } from '@/lib/format'
import { buildTimeline } from '@/lib/timeline'
import type { Media, NewPlant, PlantDetail } from '@/types'

export function PlantPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [plant, setPlant] = useState<PlantDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [photo, setPhoto] = useState<Media | null>(null)

  // State is set in promise callbacks, never synchronously (react/set-state-in-effect).
  const load = useCallback(
    () =>
      api.getPlant(id).then(setPlant, (e: unknown) => {
        if (e instanceof ApiError && e.status === 404) setNotFound(true)
        else toast.error(errorMessage(e))
      }),
    [id],
  )

  useEffect(() => {
    void load()
  }, [load])

  const timeline = useMemo(() => (plant ? buildTimeline(plant.media, plant.waterings) : []), [plant])
  const coverId = useMemo(() => plant?.media.find((m) => isInlineImage(m.content_type))?.id ?? null, [plant])

  // Wraps an action: run it, toast on failure, reload on success.
  const act = (fn: () => Promise<unknown>, success?: string) => async () => {
    try {
      await fn()
      if (success) toast.success(success)
      await load()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (notFound) {
    return (
      <div className="grid place-items-center gap-4 py-24 text-center">
        <p className="text-6xl">🍂</p>
        <h1 className="font-heading text-3xl font-semibold">That plant isn’t in your garden</h1>
        <Button asChild>
          <Link to="/">Back to the garden</Link>
        </Button>
      </div>
    )
  }
  if (!plant) return <div className="h-96 animate-pulse rounded-3xl bg-muted" aria-label="Loading plant" />

  async function update(p: NewPlant) {
    const { last_watered_on: _ignored, ...patch } = p
    await api.updatePlant(id, patch)
    toast.success('Saved')
    await load()
  }

  async function remove() {
    try {
      await api.deletePlant(id)
      toast.success(`${plant!.name} was removed`)
      navigate('/')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid gap-8">
      <Link to="/" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Garden
      </Link>

      <section className="grid overflow-hidden rounded-3xl bg-card ring-1 ring-border md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="aspect-square md:aspect-auto md:min-h-80">
          <PlantCover plant={{ name: plant.name, cover_media_id: coverId }} />
        </div>
        <div className="grid content-between gap-6 p-6 sm:p-8">
          <div className="grid gap-3">
            <WaterBadge daysUntil={plant.days_until_water} className="w-fit" />
            <div>
              <h1 className="font-heading text-4xl font-semibold tracking-tight">{plant.name}</h1>
              {plant.species && <p className="text-lg text-muted-foreground italic">{plant.species}</p>}
            </div>
            <ul className="grid gap-1.5 text-sm text-muted-foreground">
              {plant.location && (
                <li className="flex items-center gap-2">
                  <MapPin className="size-4" /> {plant.location}
                </li>
              )}
              <li className="flex items-center gap-2">
                <Repeat className="size-4" /> Water every {plant.water_every_days} {plant.water_every_days === 1 ? 'day' : 'days'}
              </li>
              <li className="flex items-center gap-2">
                <CalendarDays className="size-4" /> Last watered {formatDate(plant.last_watered_on)} · next {formatDate(plant.next_water_on)}
              </li>
            </ul>
            {plant.notes && <p className="rounded-xl bg-muted/60 p-3 text-sm whitespace-pre-line">{plant.notes}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={act(() => api.waterPlant(id), `${plant.name} says thanks 💧`)}>
              <Droplets /> Water now
            </Button>
            <PlantFormDialog
              title={`Edit ${plant.name}`}
              initial={plant}
              onSubmit={update}
              trigger={
                <Button size="lg" variant="outline">
                  <Pencil /> Edit
                </Button>
              }
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="lg" variant="destructive">
                  <Trash2 /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {plant.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the plant, its watering history and all {plant.media.length} photos/files. It can’t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={remove}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="grid content-start gap-3">
          <h2 className="font-heading text-2xl font-semibold">Add to the story</h2>
          <MediaDropzone onUpload={(file, caption) => api.uploadMedia(id, file, caption).then(load)} />
        </section>
        <section className="grid content-start gap-4">
          <h2 className="font-heading text-2xl font-semibold">Timeline</h2>
          <Timeline
            items={timeline}
            onOpenPhoto={setPhoto}
            onDeleteMedia={(m) => void act(() => api.deleteMedia(m.id), `Deleted ${m.filename}`)()}
          />
        </section>
      </div>

      <Dialog open={photo !== null} onOpenChange={(open) => !open && setPhoto(null)}>
        <DialogContent className="max-w-4xl p-2 sm:max-w-4xl">
          <DialogTitle className="sr-only">{photo?.caption || photo?.filename}</DialogTitle>
          {photo && (
            <figure>
              <AuthImage mediaId={photo.id} alt={photo.caption || photo.filename} className="max-h-[80vh] w-full rounded-xl object-contain" />
              <figcaption className="p-2 text-sm text-muted-foreground">
                {photo.caption || photo.filename} · {formatDate(photo.created_at)}
              </figcaption>
            </figure>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
