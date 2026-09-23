package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/manimovassagh/FullStack-DevOps/backend/internal/store"
)

func (h *Handler) listPlants(c echo.Context) error {
	plants, err := h.store.ListPlants(c.Request().Context())
	if err != nil {
		return h.fail(c, err)
	}
	if plants == nil {
		plants = []store.PlantSummary{} // JSON [] rather than null
	}
	return c.JSON(http.StatusOK, plants)
}

func (h *Handler) getPlant(c echo.Context) error {
	id, err := pathID(c)
	if err != nil {
		return errJSON(c, http.StatusBadRequest, "invalid id")
	}
	p, err := h.store.GetPlant(c.Request().Context(), id)
	if err != nil {
		return h.fail(c, err)
	}
	return c.JSON(http.StatusOK, p)
}

func (h *Handler) createPlant(c echo.Context) error {
	var in store.NewPlant
	if err := c.Bind(&in); err != nil {
		return errJSON(c, http.StatusBadRequest, "invalid JSON body")
	}
	var err error
	if in.Name, err = validateName(in.Name); err != nil {
		return errJSON(c, http.StatusBadRequest, err.Error())
	}
	if err := validateInterval(in.WaterEveryDays); err != nil {
		return errJSON(c, http.StatusBadRequest, err.Error())
	}
	if in.LastWateredOn, err = validatePastDate("last_watered_on", in.LastWateredOn); err != nil {
		return errJSON(c, http.StatusBadRequest, err.Error())
	}

	p, err := h.store.CreatePlant(c.Request().Context(), in)
	if err != nil {
		return h.fail(c, err)
	}
	return c.JSON(http.StatusCreated, p)
}

func (h *Handler) updatePlant(c echo.Context) error {
	id, err := pathID(c)
	if err != nil {
		return errJSON(c, http.StatusBadRequest, "invalid id")
	}
	var patch store.PlantPatch
	if err := c.Bind(&patch); err != nil {
		return errJSON(c, http.StatusBadRequest, "invalid JSON body")
	}
	if patch.Name != nil {
		name, err := validateName(*patch.Name)
		if err != nil {
			return errJSON(c, http.StatusBadRequest, err.Error())
		}
		patch.Name = &name
	}
	if patch.WaterEveryDays != nil {
		if err := validateInterval(*patch.WaterEveryDays); err != nil {
			return errJSON(c, http.StatusBadRequest, err.Error())
		}
	}

	p, err := h.store.UpdatePlant(c.Request().Context(), id, patch)
	if err != nil {
		return h.fail(c, err)
	}
	return c.JSON(http.StatusOK, p)
}

// deletePlant removes the S3 objects first: if that fails we keep the rows, so
// nothing in the database ever points at a file that no longer exists.
func (h *Handler) deletePlant(c echo.Context) error {
	id, err := pathID(c)
	if err != nil {
		return errJSON(c, http.StatusBadRequest, "invalid id")
	}
	ctx := c.Request().Context()

	media, err := h.store.ListMediaForPlant(ctx, id)
	if err != nil {
		return h.fail(c, err)
	}
	for _, m := range media {
		if err := h.files.Delete(ctx, m.S3Key); err != nil {
			return h.fail(c, err)
		}
	}
	if err := h.store.DeletePlant(ctx, id); err != nil {
		return h.fail(c, err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *Handler) waterPlant(c echo.Context) error {
	id, err := pathID(c)
	if err != nil {
		return errJSON(c, http.StatusBadRequest, "invalid id")
	}
	var body struct {
		WateredOn *string `json:"watered_on"`
	}
	if err := c.Bind(&body); err != nil {
		return errJSON(c, http.StatusBadRequest, "invalid JSON body")
	}
	on, err := validatePastDate("watered_on", body.WateredOn)
	if err != nil {
		return errJSON(c, http.StatusBadRequest, err.Error())
	}

	p, err := h.store.WaterPlant(c.Request().Context(), id, on)
	if err != nil {
		return h.fail(c, err)
	}
	return c.JSON(http.StatusOK, p)
}
