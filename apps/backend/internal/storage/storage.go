// Package storage keeps file bytes (photos, PDFs) outside the database.
package storage

import (
	"context"
	"errors"
	"io"
)

var ErrNotFound = errors.New("object not found")

// FileStorage is what the HTTP handlers need; S3 implements it, tests fake it.
type FileStorage interface {
	// Put needs an io.ReadSeeker: over plain HTTP (Floci) the AWS SDK must
	// read the body once to sign it and then rewind to send it.
	Put(ctx context.Context, key string, body io.ReadSeeker, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}
