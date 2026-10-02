// Command lambda runs the Plant Parent REST API as an AWS Lambda function behind
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

	"github.com/manimovassagh/FullStack-DevOps/backend-serverless/internal/config"
	"github.com/manimovassagh/FullStack-DevOps/backend-serverless/internal/handler"
	"github.com/manimovassagh/FullStack-DevOps/backend-serverless/internal/storage"
	"github.com/manimovassagh/FullStack-DevOps/backend-serverless/internal/store"
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

	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Use(middleware.Recover())
	handler.New(store.New(pool), files, cfg.MaxUploadBytes).Register(e)
	return e, nil
}
