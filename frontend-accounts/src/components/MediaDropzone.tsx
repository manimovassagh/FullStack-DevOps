import { useRef, useState, type DragEvent } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage } from '@/api'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface Props {
  onUpload: (file: File, caption: string) => Promise<void>
}

export function MediaDropzone({ onUpload }: Props) {
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(files: FileList | null) {
    if (!files?.length) return
    try {
      // Sequential on purpose: keeps the timeline order the same as the selection order.
      for (const file of Array.from(files)) {
        setUploading(file.name)
        await onUpload(file, caption.trim())
      }
      setCaption('')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setUploading(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void upload(e.dataTransfer.files)
  }

  return (
    <div className="grid gap-3">
      <Input
        placeholder="Caption (optional) — e.g. “new leaf unfurling!”"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        disabled={uploading !== null}
      />
      <button
        type="button"
        disabled={uploading !== null}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-sm text-muted-foreground transition hover:border-primary/60 hover:bg-accent/50',
          dragging && 'scale-[1.01] border-primary bg-accent',
        )}
      >
        {uploading ? <Loader2 className="size-8 animate-spin text-primary" /> : <ImagePlus className="size-8 text-primary" />}
        <span className="font-medium text-foreground">
          {uploading ? `Uploading ${uploading}…` : 'Drop photos or files here, or click to browse'}
        </span>
        <span className="text-xs">Photos show in the timeline · PDFs and other files become downloads · max 10 MB</span>
      </button>
      <input ref={inputRef} type="file" multiple hidden aria-label="Upload files" onChange={(e) => upload(e.target.files)} />
    </div>
  )
}
