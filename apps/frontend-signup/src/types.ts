// Shapes returned by the Go API. Keep in sync with backend/internal/store/models.go.

export interface Plant {
  id: string
  name: string
  species: string
  location: string
  notes: string
  water_every_days: number
  last_watered_on: string // YYYY-MM-DD
  next_water_on: string // YYYY-MM-DD, computed by the server
  days_until_water: number // <= 0 means thirsty now
  created_at: string
  updated_at: string
}

export interface PlantSummary extends Plant {
  cover_media_id: string | null
  media_count: number
}

export interface Media {
  id: string
  plant_id: string
  filename: string
  content_type: string
  size_bytes: number
  caption: string
  created_at: string
}

export interface Watering {
  id: string
  plant_id: string
  watered_on: string
  created_at: string
}

export interface PlantDetail extends Plant {
  media: Media[]
  waterings: Watering[]
}

export interface NewPlant {
  name: string
  species?: string
  location?: string
  notes?: string
  water_every_days: number
  last_watered_on?: string
}

export type PlantPatch = Partial<Omit<NewPlant, 'last_watered_on'>>
