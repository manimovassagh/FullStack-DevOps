package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"testing"

	"github.com/google/uuid"
)

// Round-trip against the Floci GCP emulator. Skipped unless STORAGE_EMULATOR_HOST and GCS_BUCKET are set.
func TestGCSRoundTrip(t *testing.T) {
	bucket := os.Getenv("GCS_BUCKET")
	if os.Getenv("STORAGE_EMULATOR_HOST") == "" || bucket == "" {
		t.Skip("STORAGE_EMULATOR_HOST / GCS_BUCKET not set; start floci-gcp and create the bucket first")
	}
	ctx := context.Background()
	s, err := NewGCS(ctx, bucket)
	if err != nil {
		t.Fatal(err)
	}

	key := "test/" + uuid.NewString()
	body := []byte("hello from a tiny plant 🌱")
	if err := s.Put(ctx, key, bytes.NewReader(body), int64(len(body)), "text/plain"); err != nil {
		t.Fatalf("Put: %v", err)
	}
	r, err := s.Get(ctx, key)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	got, _ := io.ReadAll(r)
	r.Close()
	if !bytes.Equal(got, body) {
		t.Errorf("Get = %q, want %q", got, body)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Errorf("second Delete should be a no-op, got %v", err)
	}
	if _, err := s.Get(ctx, key); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get after delete: want ErrNotFound, got %v", err)
	}
}
