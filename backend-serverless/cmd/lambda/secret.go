package main

import (
	"context"
	"fmt"
	"os"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// loadDatabaseURL fills DATABASE_URL from Secrets Manager when DATABASE_SECRET_ARN is set.
//
// Lambda has no equivalent of ECS's `secrets.valueFrom`, and a password in an
// environment variable is visible to anyone who can read the function config, so
// the function fetches it itself at cold start. The execution role allows exactly
// this one secret.
func loadDatabaseURL(ctx context.Context) error {
	arn := os.Getenv("DATABASE_SECRET_ARN")
	if arn == "" || os.Getenv("DATABASE_URL") != "" {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx) // honours AWS_ENDPOINT_URL (Floci) and the role's credentials
	if err != nil {
		return fmt.Errorf("aws config: %w", err)
	}
	out, err := secretsmanager.NewFromConfig(cfg).GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{SecretId: &arn})
	if err != nil {
		return fmt.Errorf("read database secret: %w", err)
	}
	if out.SecretString == nil {
		return fmt.Errorf("database secret has no string value")
	}
	return os.Setenv("DATABASE_URL", *out.SecretString)
}
