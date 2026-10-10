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

	// Amazon Cognito. Issuer is the exact "iss" value of the tokens, e.g.
	// https://cognito-idp.<region>.amazonaws.com/<pool id>. JWKSURL defaults to <issuer>/.well-known/jwks.json,
	// or to <AWS_ENDPOINT_URL>/<pool id>/.well-known/jwks.json behind an emulator; set it to override.
	CognitoIssuer   string
	CognitoJWKSURL  string
	CognitoClientID string
	SecureCookie    bool // Secure flag on the refresh cookie; false only for plain-HTTP local runs
}

func Load() (Config, error) {
	cfg := Config{
		Port:           getenv("PORT", "8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		S3Bucket:       os.Getenv("S3_BUCKET"),
		AWSEndpointURL: os.Getenv("AWS_ENDPOINT_URL"),
		AWSRegion:      getenv("AWS_REGION", "us-east-1"),
		MaxUploadBytes: 10 << 20,

		CognitoIssuer:   strings.TrimRight(os.Getenv("COGNITO_ISSUER"), "/"),
		CognitoJWKSURL:  os.Getenv("COGNITO_JWKS_URL"),
		CognitoClientID: os.Getenv("COGNITO_CLIENT_ID"),
		SecureCookie:    getenv("COOKIE_SECURE", "true") != "false",
	}
	if cfg.CognitoJWKSURL == "" && cfg.CognitoIssuer != "" {
		cfg.CognitoJWKSURL = cfg.CognitoIssuer + "/.well-known/jwks.json"
		if cfg.AWSEndpointURL != "" {
			// Behind an emulator the tokens name the emulator as seen from the host (http://localhost:4566/<pool>),
			// which is not reachable from inside a container. The keys are at <endpoint>/<pool>/.well-known/jwks.json.
			pool := cfg.CognitoIssuer[strings.LastIndex(cfg.CognitoIssuer, "/")+1:]
			cfg.CognitoJWKSURL = strings.TrimRight(cfg.AWSEndpointURL, "/") + "/" + pool + "/.well-known/jwks.json"
		}
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
	if cfg.CognitoIssuer == "" {
		missing = append(missing, "COGNITO_ISSUER")
	}
	if cfg.CognitoClientID == "" {
		missing = append(missing, "COGNITO_CLIENT_ID")
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
