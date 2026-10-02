package store

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is returned when a plant or media row does not exist.
var ErrNotFound = errors.New("not found")

// Dates without a time (last_watered_on, watered_on, ...) are plain "YYYY-MM-DD"
// strings: they are read with ::text and written with ::date, so no time zone
// conversion can ever shift them by a day.

type Plant struct {
	ID             uuid.UUID `json:"id"`
	Name           string    `json:"name"`
	Species        string    `json:"species"`
	Location       string    `json:"location"`
	Notes          string    `json:"notes"`
	WaterEveryDays int       `json:"water_every_days"`
	LastWateredOn  string    `json:"last_watered_on"`
	NextWaterOn    string    `json:"next_water_on"`    // derived in SQL
	DaysUntilWater int       `json:"days_until_water"` // derived in SQL; <= 0 means thirsty
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type PlantSummary struct {
	Plant
	CoverMediaID *uuid.UUID `json:"cover_media_id"`
	MediaCount   int        `json:"media_count"`
}

type PlantDetail struct {
	Plant
	Media     []Media    `json:"media"`
	Waterings []Watering `json:"waterings"`
}

type NewPlant struct {
	Name           string  `json:"name"`
	Species        string  `json:"species"`
	Location       string  `json:"location"`
	Notes          string  `json:"notes"`
	WaterEveryDays int     `json:"water_every_days"`
	LastWateredOn  *string `json:"last_watered_on"` // nil → today
}

// PlantPatch is a partial update: nil fields are left unchanged.
type PlantPatch struct {
	Name           *string `json:"name"`
	Species        *string `json:"species"`
	Location       *string `json:"location"`
	Notes          *string `json:"notes"`
	WaterEveryDays *int    `json:"water_every_days"`
}

type Media struct {
	ID          uuid.UUID `json:"id"`
	PlantID     uuid.UUID `json:"plant_id"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	Caption     string    `json:"caption"`
	S3Key       string    `json:"-"` // internal: where the bytes live in the bucket
	CreatedAt   time.Time `json:"created_at"`
}

type Watering struct {
	ID        uuid.UUID `json:"id"`
	PlantID   uuid.UUID `json:"plant_id"`
	WateredOn string    `json:"watered_on"`
	CreatedAt time.Time `json:"created_at"`
}
