package handler

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/manimovassagh/FullStack-DevOps/backend-serverless/internal/store"
)

func TestHealth(t *testing.T) {
	v := newEnv()
	expectStatus(t, v.do(t, http.MethodGet, "/api/health", nil), http.StatusOK)

	v.store.pingErr = errBoom
	expectStatus(t, v.do(t, http.MethodGet, "/api/health", nil), http.StatusServiceUnavailable)
}

func TestCreatePlant(t *testing.T) {
	v := newEnv()
	rec := v.do(t, http.MethodPost, "/api/plants", map[string]any{"name": "  Monstera  ", "species": "M. deliciosa", "water_every_days": 7})
	expectStatus(t, rec, http.StatusCreated)
	p := decode[store.Plant](t, rec)
	if p.Name != "Monstera" || p.Species != "M. deliciosa" || p.WaterEveryDays != 7 {
		t.Errorf("got %+v (name should be trimmed)", p)
	}
}

func TestCreatePlantValidation(t *testing.T) {
	tomorrowPlus := time.Now().UTC().AddDate(0, 0, 3).Format(time.DateOnly)
	cases := map[string]struct {
		body map[string]any
		msg  string
	}{
		"blank name":       {map[string]any{"name": "   ", "water_every_days": 7}, "name is required"},
		"long name":        {map[string]any{"name": strings.Repeat("a", 101), "water_every_days": 7}, "at most 100"},
		"interval 0":       {map[string]any{"name": "x", "water_every_days": 0}, "between 1 and 365"},
		"interval 366":     {map[string]any{"name": "x", "water_every_days": 366}, "between 1 and 365"},
		"bad date":         {map[string]any{"name": "x", "water_every_days": 7, "last_watered_on": "20/09/2026"}, "YYYY-MM-DD"},
		"future date":      {map[string]any{"name": "x", "water_every_days": 7, "last_watered_on": tomorrowPlus}, "future"},
		"wrong field type": {map[string]any{"name": "x", "water_every_days": "seven"}, "invalid JSON"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			expectError(t, newEnv().do(t, http.MethodPost, "/api/plants", tc.body), http.StatusBadRequest, tc.msg)
		})
	}
}

func TestListPlantsReturnsArray(t *testing.T) {
	v := newEnv()
	rec := v.do(t, http.MethodGet, "/api/plants", nil)
	expectStatus(t, rec, http.StatusOK)
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("empty list body = %s, want []", rec.Body.String())
	}

	v.seedPlant(t, "Basil")
	v.seedPlant(t, "Cactus")
	if got := decode[[]store.PlantSummary](t, v.do(t, http.MethodGet, "/api/plants", nil)); len(got) != 2 {
		t.Errorf("len = %d, want 2", len(got))
	}
}

func TestGetPlant(t *testing.T) {
	v := newEnv()
	p := v.seedPlant(t, "Fern")

	got := decode[store.PlantDetail](t, v.do(t, http.MethodGet, "/api/plants/"+p.ID.String(), nil))
	if got.ID != p.ID || got.Media == nil || got.Waterings == nil {
		t.Errorf("got %+v", got)
	}
	expectError(t, v.do(t, http.MethodGet, "/api/plants/"+uuid.NewString(), nil), http.StatusNotFound, "not found")
	expectError(t, v.do(t, http.MethodGet, "/api/plants/not-a-uuid", nil), http.StatusBadRequest, "invalid id")
}

func TestUpdatePlant(t *testing.T) {
	v := newEnv()
	p := v.seedPlant(t, "Pothos")

	rec := v.do(t, http.MethodPatch, "/api/plants/"+p.ID.String(), map[string]any{"location": "Kitchen", "water_every_days": 10})
	expectStatus(t, rec, http.StatusOK)
	got := decode[store.Plant](t, rec)
	if got.Name != "Pothos" || got.Location != "Kitchen" || got.WaterEveryDays != 10 {
		t.Errorf("got %+v", got)
	}

	expectError(t, v.do(t, http.MethodPatch, "/api/plants/"+p.ID.String(), map[string]any{"name": ""}), http.StatusBadRequest, "name is required")
	expectError(t, v.do(t, http.MethodPatch, "/api/plants/"+p.ID.String(), map[string]any{"water_every_days": 0}), http.StatusBadRequest, "between")
	expectError(t, v.do(t, http.MethodPatch, "/api/plants/"+uuid.NewString(), map[string]any{"notes": "x"}), http.StatusNotFound, "not found")
}

func TestWaterPlant(t *testing.T) {
	v := newEnv()
	p := v.seedPlant(t, "Basil")
	path := "/api/plants/" + p.ID.String() + "/water"

	// Empty body → today.
	rec := v.do(t, http.MethodPost, path, nil)
	expectStatus(t, rec, http.StatusOK)
	if got := decode[store.Plant](t, rec); got.LastWateredOn != time.Now().UTC().Format(time.DateOnly) {
		t.Errorf("LastWateredOn = %s, want today", got.LastWateredOn)
	}

	past := time.Now().UTC().AddDate(0, 0, -2).Format(time.DateOnly)
	expectStatus(t, v.do(t, http.MethodPost, path, map[string]any{"watered_on": past}), http.StatusOK)
	if n := len(v.store.waterings[p.ID]); n != 2 {
		t.Errorf("waterings = %d, want 2", n)
	}

	future := time.Now().UTC().AddDate(0, 0, 5).Format(time.DateOnly)
	expectError(t, v.do(t, http.MethodPost, path, map[string]any{"watered_on": future}), http.StatusBadRequest, "future")
	expectError(t, v.do(t, http.MethodPost, "/api/plants/"+uuid.NewString()+"/water", nil), http.StatusNotFound, "not found")
}

func TestDeletePlantRemovesFilesFirst(t *testing.T) {
	v := newEnv()
	p := v.seedPlant(t, "Monstera")
	rec := v.upload(t, "/api/plants/"+p.ID.String()+"/media", "leaf.png", "image/png", []byte("png!"), "")
	expectStatus(t, rec, http.StatusCreated)

	// If S3 fails, the plant must survive so no row points at a deleted file.
	v.files.deleteErr = errBoom
	expectStatus(t, v.do(t, http.MethodDelete, "/api/plants/"+p.ID.String(), nil), http.StatusInternalServerError)
	if _, ok := v.store.plants[p.ID]; !ok {
		t.Fatal("plant was deleted even though S3 delete failed")
	}

	v.files.deleteErr = nil
	expectStatus(t, v.do(t, http.MethodDelete, "/api/plants/"+p.ID.String(), nil), http.StatusNoContent)
	if len(v.files.objects) != 0 || len(v.store.plants) != 0 {
		t.Errorf("leftovers: objects=%d plants=%d", len(v.files.objects), len(v.store.plants))
	}
	expectStatus(t, v.do(t, http.MethodDelete, "/api/plants/"+p.ID.String(), nil), http.StatusNotFound)
}
