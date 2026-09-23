import { Camera, Droplet, FileText, Trash2 } from 'lucide-react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDate, isInlineImage } from '@/lib/format'
import type { TimelineItem } from '@/lib/timeline'
import type { Media } from '@/types'

interface Props {
  items: TimelineItem[]
  onOpenPhoto: (media: Media) => void
  onDeleteMedia: (media: Media) => void
}

export function Timeline({ items, onOpenPhoto, onDeleteMedia }: Props) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        No story yet — upload a first photo to start this plant’s timeline. 📸
      </p>
    )
  }

  return (
    <ol className="relative ml-4 border-l-2 border-dashed border-border">
      {items.map((item) => (
        <li key={item.key} className="relative pb-8 pl-8 last:pb-0">
          <span className="absolute top-0 -left-[15px] grid size-7 place-items-center rounded-full bg-background ring-2 ring-border">
            {item.kind === 'water' ? (
              <Droplet className="size-3.5 fill-sky-500 text-sky-500" />
            ) : isInlineImage(item.media.content_type) ? (
              <Camera className="size-3.5 text-primary" />
            ) : (
              <FileText className="size-3.5 text-muted-foreground" />
            )}
          </span>
          <time className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{formatDate(item.date)}</time>
          {item.kind === 'water' ? (
            <p className="mt-1 text-sm">Watered 💧</p>
          ) : (
            <MediaEntry media={item.media} onOpenPhoto={onOpenPhoto} onDelete={onDeleteMedia} />
          )}
        </li>
      ))}
    </ol>
  )
}

function MediaEntry({ media, onOpenPhoto, onDelete }: { media: Media; onOpenPhoto: (m: Media) => void; onDelete: (m: Media) => void }) {
  const remove = (
    <Button variant="ghost" size="icon-sm" onClick={() => onDelete(media)} aria-label={`Delete ${media.filename}`}>
      <Trash2 />
    </Button>
  )

  if (isInlineImage(media.content_type)) {
    return (
      <figure className="group mt-2 w-fit">
        <button type="button" onClick={() => onOpenPhoto(media)} className="block overflow-hidden rounded-2xl ring-1 ring-border">
          <img
            src={api.mediaUrl(media.id)}
            alt={media.caption || media.filename}
            loading="lazy"
            className="max-h-72 w-auto object-cover transition duration-500 group-hover:scale-[1.02]"
          />
        </button>
        <figcaption className="mt-1 flex items-center gap-2 text-sm">
          <span className={media.caption ? '' : 'text-muted-foreground'}>{media.caption || media.filename}</span>
          {remove}
        </figcaption>
      </figure>
    )
  }

  return (
    <div className="mt-2 flex w-fit items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
      <FileText className="size-8 text-primary" />
      <div className="min-w-0">
        <a href={api.mediaUrl(media.id)} className="font-medium hover:underline" download={media.filename}>
          {media.filename}
        </a>
        <p className="text-xs text-muted-foreground">
          {formatBytes(media.size_bytes)}
          {media.caption && ` · ${media.caption}`}
        </p>
      </div>
      {remove}
    </div>
  )
}
