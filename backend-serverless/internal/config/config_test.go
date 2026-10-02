package config

import (
	"strings"
	"testing"
)

func setRequired(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("S3_BUCKET", "plant-media")
}

func TestLoadDefaults(t *testing.T) {
	setRequired(t)
	for _, k := range []string{"PORT", "AWS_REGION", "AWS_ENDPOINT_URL", "MAX_UPLOAD_BYTES"} {
		t.Setenv(k, "")
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != "8080" || cfg.AWSRegion != "us-east-1" || cfg.MaxUploadBytes != 10<<20 || cfg.AWSEndpointURL != "" {
		t.Errorf("unexpected defaults: %+v", cfg)
	}
}

func TestLoadReportsAllMissingVars(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("S3_BUCKET", "")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") || !strings.Contains(err.Error(), "S3_BUCKET") {
		t.Fatalf("want error naming both vars, got %v", err)
	}
}

func TestLoadRejectsBadMaxUpload(t *testing.T) {
	for _, v := range []string{"abc", "0", "-5"} {
		t.Run(v, func(t *testing.T) {
			setRequired(t)
			t.Setenv("MAX_UPLOAD_BYTES", v)
			if _, err := Load(); err == nil {
				t.Fatalf("want error for MAX_UPLOAD_BYTES=%q", v)
			}
		})
	}
}

func TestLoadOverrides(t *testing.T) {
	setRequired(t)
	t.Setenv("PORT", "9000")
	t.Setenv("AWS_ENDPOINT_URL", "http://localhost:4566")
	t.Setenv("MAX_UPLOAD_BYTES", "2048")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != "9000" || cfg.AWSEndpointURL != "http://localhost:4566" || cfg.MaxUploadBytes != 2048 {
		t.Errorf("overrides not applied: %+v", cfg)
	}
}
