// Package storage keeps file bytes (photos, PDFs) outside the database.
package storage

import (
	"context"
	"errors"
	"io"
)

var ErrNotFound = errors.New("object not found")

// FileStorage is what the HTTP handlers need; GCS implements it, tests fake it.
type FileStorage interface {
	// Put takes an io.ReadSeeker so implementations can rewind to retry.
	Put(ctx context.Context, key string, body io.ReadSeeker, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}
