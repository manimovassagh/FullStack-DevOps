package config

import (
	"strings"
	"testing"
)

func setRequired(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("S3_BUCKET", "plant-media")
	t.Setenv("COGNITO_ISSUER", "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x/")
	t.Setenv("COGNITO_CLIENT_ID", "client")
	t.Setenv("COGNITO_JWKS_URL", "")
	t.Setenv("COOKIE_SECURE", "")
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

func TestCognitoSettings(t *testing.T) {
	setRequired(t)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.CognitoIssuer != "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x" {
		t.Errorf("issuer keeps its trailing slash: %q", cfg.CognitoIssuer)
	}
	if cfg.CognitoJWKSURL != cfg.CognitoIssuer+"/.well-known/jwks.json" || !cfg.SecureCookie {
		t.Errorf("defaults: %+v", cfg)
	}

	t.Setenv("COGNITO_JWKS_URL", "http://floci:4566/pool/.well-known/jwks.json")
	t.Setenv("COOKIE_SECURE", "false")
	cfg, _ = Load()
	if cfg.CognitoJWKSURL != "http://floci:4566/pool/.well-known/jwks.json" || cfg.SecureCookie {
		t.Errorf("overrides: %+v", cfg)
	}
}

func TestCognitoIsRequired(t *testing.T) {
	setRequired(t)
	t.Setenv("COGNITO_ISSUER", "")
	t.Setenv("COGNITO_CLIENT_ID", "")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "COGNITO_ISSUER") || !strings.Contains(err.Error(), "COGNITO_CLIENT_ID") {
		t.Fatalf("err = %v", err)
	}
}
