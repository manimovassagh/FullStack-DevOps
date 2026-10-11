package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func (s *Postgres) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// plantCols selects a plant row (aliased "p") plus the two derived schedule fields.
// date + int = date and date - date = int in Postgres, so no Go date math is needed.
const plantCols = `p.id, p.name, p.species, p.location, p.notes, p.water_every_days,
	p.last_watered_on::text,
	(p.last_watered_on + p.water_every_days)::text,
	(p.last_watered_on + p.water_every_days) - CURRENT_DATE,
	p.created_at, p.updated_at`

func plantDest(p *Plant) []any {
	return []any{&p.ID, &p.Name, &p.Species, &p.Location, &p.Notes, &p.WaterEveryDays,
		&p.LastWateredOn, &p.NextWaterOn, &p.DaysUntilWater, &p.CreatedAt, &p.UpdatedAt}
}

func scanPlant(row pgx.Row) (Plant, error) {
	var p Plant
	if err := row.Scan(plantDest(&p)...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Plant{}, ErrNotFound
		}
		return Plant{}, err
	}
	return p, nil
}

// ListPlants returns every plant, thirstiest first, with its cover photo and media count.
func (s *Postgres) ListPlants(ctx context.Context) ([]PlantSummary, error) {
	sc, err := scope(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+plantCols+`,
			(SELECT m.id FROM media m
			  WHERE m.plant_id = p.id
			    AND m.content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
			  ORDER BY m.created_at DESC LIMIT 1),
			(SELECT count(*) FROM media m WHERE m.plant_id = p.id)
		FROM plants p
		WHERE ($1::text = '' OR p.owner_id = $1)
		ORDER BY p.last_watered_on + p.water_every_days, p.name`, sc)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PlantSummary, error) {
		var ps PlantSummary
		err := row.Scan(append(plantDest(&ps.Plant), &ps.CoverMediaID, &ps.MediaCount)...)
		return ps, err
	})
}

// GetPlant returns a plant with its media and waterings, both newest first.
func (s *Postgres) GetPlant(ctx context.Context, id uuid.UUID) (PlantDetail, error) {
	sc, err := scope(ctx)
	if err != nil {
		return PlantDetail{}, err
	}
	p, err := scanPlant(s.pool.QueryRow(ctx,
		`SELECT `+plantCols+` FROM plants p WHERE p.id = $1 AND ($2::text = '' OR p.owner_id = $2)`, id, sc))
	if err != nil {
		return PlantDetail{}, err
	}
	media, err := s.ListMediaForPlant(ctx, id)
	if err != nil {
		return PlantDetail{}, err
	}
	waterings, err := s.listWaterings(ctx, id)
	if err != nil {
		return PlantDetail{}, err
	}
	return PlantDetail{Plant: p, Media: media, Waterings: waterings}, nil
}

func (s *Postgres) CreatePlant(ctx context.Context, in NewPlant) (Plant, error) {
	o, err := ownerFrom(ctx)
	if err != nil {
		return Plant{}, err
	}
	return scanPlant(s.pool.QueryRow(ctx, `
		INSERT INTO plants AS p (id, name, species, location, notes, water_every_days, last_watered_on, owner_id)
		VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8)
		RETURNING `+plantCols,
		uuid.New(), in.Name, in.Species, in.Location, in.Notes, in.WaterEveryDays, in.LastWateredOn, o.ID))
}

// UpdatePlant applies a partial update; COALESCE keeps the current value for nil fields.
func (s *Postgres) UpdatePlant(ctx context.Context, id uuid.UUID, patch PlantPatch) (Plant, error) {
	sc, err := scope(ctx)
	if err != nil {
		return Plant{}, err
	}
	return scanPlant(s.pool.QueryRow(ctx, `
		UPDATE plants AS p SET
			name             = COALESCE($2, p.name),
			species          = COALESCE($3, p.species),
			location         = COALESCE($4, p.location),
			notes            = COALESCE($5, p.notes),
			water_every_days = COALESCE($6, p.water_every_days),
			updated_at       = now()
		WHERE p.id = $1 AND ($7::text = '' OR p.owner_id = $7)
		RETURNING `+plantCols,
		id, patch.Name, patch.Species, patch.Location, patch.Notes, patch.WaterEveryDays, sc))
}

func (s *Postgres) DeletePlant(ctx context.Context, id uuid.UUID) error {
	sc, err := scope(ctx)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM plants p WHERE p.id = $1 AND ($2::text = '' OR p.owner_id = $2)`, id, sc)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// WaterPlant records a watering on the given date (nil → today). Logging an
// older watering never moves last_watered_on backwards.
func (s *Postgres) WaterPlant(ctx context.Context, id uuid.UUID, on *string) (Plant, error) {
	sc, err := scope(ctx)
	if err != nil {
		return Plant{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Plant{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	p, err := scanPlant(tx.QueryRow(ctx, `
		UPDATE plants AS p SET
			last_watered_on = GREATEST(p.last_watered_on, COALESCE($2::date, CURRENT_DATE)),
			updated_at      = now()
		WHERE p.id = $1 AND ($3::text = '' OR p.owner_id = $3)
		RETURNING `+plantCols, id, on, sc))
	if err != nil {
		return Plant{}, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO waterings (id, plant_id, watered_on) VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE))`,
		uuid.New(), id, on); err != nil {
		return Plant{}, fmt.Errorf("insert watering: %w", err)
	}
	return p, tx.Commit(ctx)
}

func (s *Postgres) listWaterings(ctx context.Context, plantID uuid.UUID) ([]Watering, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, plant_id, watered_on::text, created_at FROM waterings
		WHERE plant_id = $1 ORDER BY watered_on DESC, created_at DESC`, plantID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Watering, error) {
		var w Watering
		err := row.Scan(&w.ID, &w.PlantID, &w.WateredOn, &w.CreatedAt)
		return w, err
	})
}
