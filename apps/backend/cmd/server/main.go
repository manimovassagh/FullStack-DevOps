// Command server runs the Plant Parent REST API.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/manimovassagh/FullStack-DevOps/backend/internal/config"
	"github.com/manimovassagh/FullStack-DevOps/backend/internal/handler"
	"github.com/manimovassagh/FullStack-DevOps/backend/internal/storage"
	"github.com/manimovassagh/FullStack-DevOps/backend/internal/store"
)

func main() {
	// JSON logs: easy to read in CloudWatch Logs once this runs on ECS.
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("server exited", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// ECS stops tasks with SIGTERM; cancel the context so we shut down cleanly.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("postgres pool: %w", err)
	}
	defer pool.Close()
	if err := store.Migrate(ctx, pool); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}

	files, err := storage.NewS3(ctx, cfg.AWSRegion, cfg.AWSEndpointURL, cfg.S3Bucket)
	if err != nil {
		return err
	}

	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.Use(middleware.Recover())
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogMethod: true, LogURI: true, LogStatus: true, LogLatency: true,
		LogValuesFunc: func(_ echo.Context, v middleware.RequestLoggerValues) error {
			slog.Info("request", "method", v.Method, "uri", v.URI, "status", v.Status, "latency_ms", v.Latency.Milliseconds())
			return nil
		},
	}))
	handler.New(store.New(pool), files, cfg.MaxUploadBytes).Register(e)

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "port", cfg.Port, "s3_endpoint", cfg.AWSEndpointURL, "bucket", cfg.S3Bucket)
		errCh <- e.Start(":" + cfg.Port)
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}

	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return e.Shutdown(shutdownCtx)
}
