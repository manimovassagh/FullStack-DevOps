import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { api } from '@/api'

// Shows a protected photo: fetched with the bearer token, displayed from a blob URL.
export function AuthImage({ mediaId, alt, ...rest }: { mediaId: string; alt: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    api
      .mediaBlobUrl(mediaId)
      .then((u) => {
        if (cancelled) URL.revokeObjectURL(u)
        else {
          url = u
          setSrc(u)
        }
      })
      .catch(() => setSrc(null))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [mediaId])

  if (!src) return <div role="img" aria-label={alt} className={`animate-pulse bg-muted ${rest.className ?? ''}`} style={{ minHeight: '4rem', minWidth: '4rem' }} />
  return <img src={src} alt={alt} {...rest} />
}
