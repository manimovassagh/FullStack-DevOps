// Package handler exposes the REST API under /api.
package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/manimovassagh/FullStack-DevOps/backend-auth/internal/storage"
	"github.com/manimovassagh/FullStack-DevOps/backend-auth/internal/store"
)

// Store is the persistence the handlers need. *store.Postgres implements it;
// tests use an in-memory fake.
type Store interface {
	Ping(ctx context.Context) error
	ListPlants(ctx context.Context) ([]store.PlantSummary, error)
	GetPlant(ctx context.Context, id uuid.UUID) (store.PlantDetail, error)
	CreatePlant(ctx context.Context, in store.NewPlant) (store.Plant, error)
	UpdatePlant(ctx context.Context, id uuid.UUID, patch store.PlantPatch) (store.Plant, error)
	DeletePlant(ctx context.Context, id uuid.UUID) error
	WaterPlant(ctx context.Context, id uuid.UUID, on *string) (store.Plant, error)
	CreateMedia(ctx context.Context, m store.Media) (store.Media, error)
	GetMedia(ctx context.Context, id uuid.UUID) (store.Media, error)
	ListMediaForPlant(ctx context.Context, plantID uuid.UUID) ([]store.Media, error)
	DeleteMedia(ctx context.Context, id uuid.UUID) error
}

type Handler struct {
	store     Store
	files     storage.FileStorage
	maxUpload int64
}

func New(s Store, f storage.FileStorage, maxUpload int64) *Handler {
	return &Handler{store: s, files: f, maxUpload: maxUpload}
}

// Register mounts the API. Everything except /api/health is wrapped in protect (the
// authentication middleware); /api/health stays open because the load balancer polls it.
// Sign-in routes are added to the returned public group by the caller.
func (h *Handler) Register(e *echo.Echo, protect ...echo.MiddlewareFunc) *echo.Group {
	public := e.Group("/api")
	public.GET("/health", h.health)

	api := e.Group("/api", protect...)
	api.GET("/plants", h.listPlants)
	api.POST("/plants", h.createPlant)
	api.GET("/plants/:id", h.getPlant)
	api.PATCH("/plants/:id", h.updatePlant)
	api.DELETE("/plants/:id", h.deletePlant)
	api.POST("/plants/:id/water", h.waterPlant)

	api.POST("/plants/:id/media", h.uploadMedia)
	api.GET("/media/:id", h.downloadMedia)
	api.DELETE("/media/:id", h.deleteMedia)
	return public
}

// health is what the ALB target group polls: cheap, and honest about the DB.
func (h *Handler) health(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 2*time.Second)
	defer cancel()
	if err := h.store.Ping(ctx); err != nil {
		slog.Warn("health check failed", "err", err)
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
	}
	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

func errJSON(c echo.Context, status int, msg string) error {
	return c.JSON(status, map[string]string{"error": msg})
}

// fail maps domain errors to HTTP statuses; anything unexpected is logged and hidden.
func (h *Handler) fail(c echo.Context, err error) error {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return errJSON(c, http.StatusNotFound, "not found")
	case errors.Is(err, store.ErrNoOwner):
		return errJSON(c, http.StatusUnauthorized, "not signed in")
	case errors.Is(err, storage.ErrNotFound):
		return errJSON(c, http.StatusNotFound, "file not found in storage")
	}
	slog.Error("request failed", "method", c.Request().Method, "path", c.Path(), "err", err)
	return errJSON(c, http.StatusInternalServerError, "internal error")
}

func pathID(c echo.Context) (uuid.UUID, error) {
	return uuid.Parse(c.Param("id"))
}
