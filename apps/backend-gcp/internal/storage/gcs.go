package storage

import (
	"context"
	"errors"
	"fmt"
	"io"

	gcs "cloud.google.com/go/storage"
)

// GCS keeps file bytes in a Google Cloud Storage bucket.
type GCS struct {
	bucket *gcs.BucketHandle
}

// NewGCS builds a client from Application Default Credentials (the Cloud Run service account when deployed).
// When STORAGE_EMULATOR_HOST is set (the Floci GCP emulator locally) the library talks to it
// without credentials; nothing in this code changes between the emulator and real Google Cloud.
func NewGCS(ctx context.Context, bucket string) (*GCS, error) {
	client, err := gcs.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("gcs client: %w", err)
	}
	return &GCS{bucket: client.Bucket(bucket)}, nil
}

// Put streams the body into the object; size is only informational (the writer chunks by itself).
func (g *GCS) Put(ctx context.Context, key string, body io.ReadSeeker, _ int64, contentType string) error {
	w := g.bucket.Object(key).NewWriter(ctx)
	w.ContentType = contentType
	if _, err := io.Copy(w, body); err != nil {
		_ = w.Close()
		return fmt.Errorf("gcs put %s: %w", key, err)
	}
	if err := w.Close(); err != nil { // the upload is only committed on Close
		return fmt.Errorf("gcs put %s: %w", key, err)
	}
	return nil
}

func (g *GCS) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	r, err := g.bucket.Object(key).NewReader(ctx)
	if err != nil {
		if errors.Is(err, gcs.ErrObjectNotExist) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("gcs get %s: %w", key, err)
	}
	return r, nil
}

// Delete is idempotent: deleting a missing object is not an error.
func (g *GCS) Delete(ctx context.Context, key string) error {
	if err := g.bucket.Object(key).Delete(ctx); err != nil && !errors.Is(err, gcs.ErrObjectNotExist) {
		return fmt.Errorf("gcs delete %s: %w", key, err)
	}
	return nil
}
