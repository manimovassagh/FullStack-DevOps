package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const mediaCols = `id, plant_id, filename, content_type, size_bytes, caption, s3_key, created_at`

func scanMedia(row pgx.Row) (Media, error) {
	var m Media
	err := row.Scan(&m.ID, &m.PlantID, &m.Filename, &m.ContentType, &m.SizeBytes, &m.Caption, &m.S3Key, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Media{}, ErrNotFound
	}
	return m, err
}

// CreateMedia inserts a media row. The caller chooses ID and S3Key because the
// object is uploaded to S3 before the row exists.
func (s *Postgres) CreateMedia(ctx context.Context, m Media) (Media, error) {
	saved, err := scanMedia(s.pool.QueryRow(ctx, `
		INSERT INTO media (id, plant_id, filename, content_type, size_bytes, caption, s3_key)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+mediaCols,
		m.ID, m.PlantID, m.Filename, m.ContentType, m.SizeBytes, m.Caption, m.S3Key))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" { // foreign_key_violation: plant is gone
		return Media{}, ErrNotFound
	}
	return saved, err
}

func (s *Postgres) GetMedia(ctx context.Context, id uuid.UUID) (Media, error) {
	return scanMedia(s.pool.QueryRow(ctx, `SELECT `+mediaCols+` FROM media WHERE id = $1`, id))
}

func (s *Postgres) ListMediaForPlant(ctx context.Context, plantID uuid.UUID) ([]Media, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+mediaCols+` FROM media WHERE plant_id = $1 ORDER BY created_at DESC`, plantID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Media, error) { return scanMedia(row) })
}

func (s *Postgres) DeleteMedia(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM media WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
