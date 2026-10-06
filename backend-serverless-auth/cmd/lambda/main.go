// Command lambda runs the Plant Parent REST API with Amazon Cognito sign-in as an AWS Lambda function behind
// an API Gateway HTTP API (payload format 2.0).
//
// It is the same Echo router as the container build, wrapped by a small adapter
// (adapter.go) that turns each API Gateway event into an http.Request.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/manimovassagh/FullStack-DevOps/backend-serverless-auth/internal/auth"
	"github.com/manimovassagh/FullStack-DevOps/backend-serverless-auth/internal/config"
	"github.com/manimovassagh/FullStack-DevOps/backend-serverless-auth/internal/handler"
	"github.com/manimovassagh/FullStack-DevOps/backend-serverless-auth/internal/storage"
	"github.com/manimovassagh/FullStack-DevOps/backend-serverless-auth/internal/store"
)

var (
	once    sync.Once
	app     *echo.Echo
	initErr error
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	lambda.Start(handle)
}

func handle(ctx context.Context, ev events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	// Cold start: build the router and open the DB pool once; warm invocations reuse them.
	once.Do(func() { app, initErr = newApp(ctx) })
	if initErr != nil {
		slog.Error("init failed", "err", initErr)
		return events.APIGatewayV2HTTPResponse{StatusCode: 500, Body: `{"error":"service unavailable"}`}, nil
	}
	return serve(ctx, app, ev)
}

func newApp(ctx context.Context) (*echo.Echo, error) {
	if err := loadDatabaseURL(ctx); err != nil {
		return nil, err
	}
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	// Small pool: every concurrent Lambda instance holds its own connections, so
	// many instances × a big pool would exhaust Postgres.
	pcfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("database url: %w", err)
	}
	pcfg.MaxConns = 2
	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, fmt.Errorf("postgres pool: %w", err)
	}
	if err := store.Migrate(ctx, pool); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	files, err := storage.NewS3(ctx, cfg.AWSRegion, cfg.AWSEndpointURL, cfg.S3Bucket)
	if err != nil {
		return nil, err
	}

	// Cognito: the pool's signing keys are fetched once per cold start and refreshed in the background.
	verifier, err := auth.NewVerifier(ctx, cfg.CognitoIssuer, cfg.CognitoJWKSURL, cfg.CognitoClientID)
	if err != nil {
		return nil, err
	}
	idp, err := auth.NewCognitoClient(ctx, cfg.AWSRegion, cfg.AWSEndpointURL)
	if err != nil {
		return nil, err
	}

	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Use(middleware.Recover())
	public := handler.New(store.New(pool), files, cfg.MaxUploadBytes).Register(e, verifier.Require)
	login := &auth.Login{IDP: idp, ClientID: cfg.CognitoClientID, SecureCookie: cfg.SecureCookie}
	login.Register(public)
	e.GET("/api/auth/me", login.Me, verifier.Require)
	return e, nil
}
