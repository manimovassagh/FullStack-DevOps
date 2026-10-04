import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { todayISO } from '@/lib/format'
import type { NewPlant, Plant } from '@/types'

interface Props {
  trigger: ReactNode
  title: string
  initial?: Plant // present → edit mode
  onSubmit: (plant: NewPlant) => Promise<void>
}

export function PlantFormDialog({ trigger, title, initial, onSubmit }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const text = (k: string) => String(f.get(k) ?? '').trim()
    const plant: NewPlant = {
      name: text('name'),
      species: text('species'),
      location: text('location'),
      notes: text('notes'),
      water_every_days: Number(f.get('water_every_days')),
    }
    if (!initial && text('last_watered_on')) plant.last_watered_on = text('last_watered_on')

    setSaving(true)
    try {
      await onSubmit(plant)
      setOpen(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{title}</DialogTitle>
          <DialogDescription>
            {initial ? 'Update the details and watering rhythm.' : 'Tell us about your new green friend.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <Field id="name" label="Name">
            <Input id="name" name="name" required maxLength={100} placeholder="Monty the Monstera" defaultValue={initial?.name} autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="species" label="Species">
              <Input id="species" name="species" placeholder="Monstera deliciosa" defaultValue={initial?.species} />
            </Field>
            <Field id="location" label="Location">
              <Input id="location" name="location" placeholder="Living room window" defaultValue={initial?.location} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="water_every_days" label="Water every (days)">
              <Input
                id="water_every_days"
                name="water_every_days"
                type="number"
                min={1}
                max={365}
                required
                defaultValue={initial?.water_every_days ?? 7}
              />
            </Field>
            {!initial && (
              <Field id="last_watered_on" label="Last watered">
                <Input id="last_watered_on" name="last_watered_on" type="date" max={todayISO()} defaultValue={todayISO()} />
              </Field>
            )}
          </div>
          <Field id="notes" label="Notes">
            <Textarea id="notes" name="notes" rows={3} placeholder="Likes bright indirect light…" defaultValue={initial?.notes} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Add to garden'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
