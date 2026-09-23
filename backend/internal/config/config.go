// Package config reads all runtime settings from environment variables, so the
// same binary runs unchanged on a laptop, in Docker, on Floci's ECS or real AWS.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port           string
	DatabaseURL    string
	S3Bucket       string
	AWSEndpointURL string // empty means "real AWS"; set to Floci's URL locally
	AWSRegion      string
	MaxUploadBytes int64
}

func Load() (Config, error) {
	cfg := Config{
		Port:           getenv("PORT", "8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		S3Bucket:       os.Getenv("S3_BUCKET"),
		AWSEndpointURL: os.Getenv("AWS_ENDPOINT_URL"),
		AWSRegion:      getenv("AWS_REGION", "us-east-1"),
		MaxUploadBytes: 10 << 20,
	}

	if v := os.Getenv("MAX_UPLOAD_BYTES"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 {
			return Config{}, fmt.Errorf("MAX_UPLOAD_BYTES must be a positive integer, got %q", v)
		}
		cfg.MaxUploadBytes = n
	}

	var missing []string
	if cfg.DatabaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}
	if cfg.S3Bucket == "" {
		missing = append(missing, "S3_BUCKET")
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required env vars: %s", strings.Join(missing, ", "))
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
