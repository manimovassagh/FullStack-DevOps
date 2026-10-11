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

// Round-trip against Floci's S3 (`make up`). Skipped when no endpoint is configured.
func TestS3RoundTrip(t *testing.T) {
	endpoint, bucket := os.Getenv("AWS_ENDPOINT_URL"), os.Getenv("S3_BUCKET")
	if endpoint == "" || bucket == "" {
		t.Skip("AWS_ENDPOINT_URL / S3_BUCKET not set; run `make up` then `make test-backend`")
	}
	ctx := context.Background()
	s, err := NewS3(ctx, "us-east-1", endpoint, bucket)
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
	if _, err := s.Get(ctx, key); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get after delete: want ErrNotFound, got %v", err)
	}
}
