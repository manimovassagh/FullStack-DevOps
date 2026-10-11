package handler

import (
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/manimovassagh/FullStack-DevOps/backend/internal/store"
)

// Only these are rendered inline by the browser. Everything else, notably SVG
// (which can carry scripts) and HTML, is forced to download. Keep in sync with
// frontend/src/lib/format.ts.
var inlineTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
}

// multipartOverhead leaves room for boundaries and headers on top of the file itself.
const multipartOverhead = 1 << 20

func (h *Handler) uploadMedia(c echo.Context) error {
	plantID, err := pathID(c)
	if err != nil {
		return errJSON(c, http.StatusBadRequest, "invalid id")
	}
	ctx := c.Request().Context()
	if _, err := h.store.GetPlant(ctx, plantID); err != nil {
		return h.fail(c, err)
	}

	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, h.maxUpload+multipartOverhead)
	fh, err := c.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return errJSON(c, http.StatusRequestEntityTooLarge, "file too large")
		}
		return errJSON(c, http.StatusBadRequest, `multipart field "file" is required`)
	}
	if err := validateUpload(fh, h.maxUpload); err != nil {
		if errors.Is(err, errTooLarge) {
			return errJSON(c, http.StatusRequestEntityTooLarge, err.Error())
		}
		return errJSON(c, http.StatusBadRequest, err.Error())
	}

	f, err := fh.Open()
	if err != nil {
		return h.fail(c, err)
	}
	defer f.Close()

	contentType := fh.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	m := store.Media{
		ID:          uuid.New(),
		PlantID:     plantID,
		Filename:    filepath.Base(fh.Filename),
		ContentType: contentType,
		SizeBytes:   fh.Size,
		Caption:     strings.TrimSpace(c.FormValue("caption")),
	}
	m.S3Key = fmt.Sprintf("plants/%s/%s", plantID, m.ID)

	// Bytes first, row second: a failed insert leaves at worst an orphaned object.
	if err := h.files.Put(ctx, m.S3Key, f, m.SizeBytes, contentType); err != nil {
		return h.fail(c, err)
	}
	saved, err := h.store.CreateMedia(ctx, m)
	if err != nil {
		if delErr := h.files.Delete(ctx, m.S3Key); delErr != nil {
			slog.Error("orphaned S3 object", "key", m.S3Key, "err", delErr)
		}
		return h.fail(c, err)
	}
	return c.JSON(http.StatusCreated, saved)
}

func (h *Handler) downloadMedia(c echo.Context) error {
	id, err := pathID(c)
	if err != nil {
		return errJSON(c, http.StatusBadRequest, "invalid id")
	}
	ctx := c.Request().Context()
	m, err := h.store.GetMedia(ctx, id)
	if err != nil {
		return h.fail(c, err)
	}
	body, err := h.files.Get(ctx, m.S3Key)
	if err != nil {
		return h.fail(c, err)
	}
	defer body.Close()

	disposition := "attachment"
	if inlineTypes[m.ContentType] {
		disposition = "inline"
	}
	header := c.Response().Header()
	header.Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": m.Filename}))
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Cache-Control", "private, max-age=86400") // media never changes once uploaded
	return c.Stream(http.StatusOK, m.ContentType, body)
}

func (h *Handler) deleteMedia(c echo.Context) error {
	id, err := pathID(c)
	if err != nil {
		return errJSON(c, http.StatusBadRequest, "invalid id")
	}
	ctx := c.Request().Context()
	m, err := h.store.GetMedia(ctx, id)
	if err != nil {
		return h.fail(c, err)
	}
	if err := h.files.Delete(ctx, m.S3Key); err != nil {
		return h.fail(c, err)
	}
	if err := h.store.DeleteMedia(ctx, id); err != nil {
		return h.fail(c, err)
	}
	return c.NoContent(http.StatusNoContent)
}
