package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/manimovassagh/FullStack-DevOps/backend-gcp/internal/storage"
	"github.com/manimovassagh/FullStack-DevOps/backend-gcp/internal/store"
)

// ---- in-memory Store ----

type fakeStore struct {
	plants         map[uuid.UUID]store.Plant
	media          map[uuid.UUID]store.Media
	waterings      map[uuid.UUID][]store.Watering
	pingErr        error
	createMediaErr error
}

func newFakeStore() *fakeStore {
	return &fakeStore{plants: map[uuid.UUID]store.Plant{}, media: map[uuid.UUID]store.Media{}, waterings: map[uuid.UUID][]store.Watering{}}
}

func (f *fakeStore) Ping(context.Context) error { return f.pingErr }

func (f *fakeStore) ListPlants(context.Context) ([]store.PlantSummary, error) {
	out := []store.PlantSummary{}
	for _, p := range f.plants {
		out = append(out, store.PlantSummary{Plant: p})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (f *fakeStore) GetPlant(ctx context.Context, id uuid.UUID) (store.PlantDetail, error) {
	p, ok := f.plants[id]
	if !ok {
		return store.PlantDetail{}, store.ErrNotFound
	}
	media, _ := f.ListMediaForPlant(ctx, id)
	return store.PlantDetail{Plant: p, Media: media, Waterings: append([]store.Watering{}, f.waterings[id]...)}, nil
}

func (f *fakeStore) CreatePlant(_ context.Context, in store.NewPlant) (store.Plant, error) {
	p := store.Plant{ID: uuid.New(), Name: in.Name, Species: in.Species, Location: in.Location, Notes: in.Notes,
		WaterEveryDays: in.WaterEveryDays, LastWateredOn: time.Now().UTC().Format(time.DateOnly),
		DaysUntilWater: in.WaterEveryDays, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if in.LastWateredOn != nil {
		p.LastWateredOn = *in.LastWateredOn
	}
	f.plants[p.ID] = p
	return p, nil
}

func (f *fakeStore) UpdatePlant(_ context.Context, id uuid.UUID, patch store.PlantPatch) (store.Plant, error) {
	p, ok := f.plants[id]
	if !ok {
		return store.Plant{}, store.ErrNotFound
	}
	if patch.Name != nil {
		p.Name = *patch.Name
	}
	if patch.Species != nil {
		p.Species = *patch.Species
	}
	if patch.Location != nil {
		p.Location = *patch.Location
	}
	if patch.Notes != nil {
		p.Notes = *patch.Notes
	}
	if patch.WaterEveryDays != nil {
		p.WaterEveryDays = *patch.WaterEveryDays
	}
	f.plants[id] = p
	return p, nil
}

func (f *fakeStore) DeletePlant(_ context.Context, id uuid.UUID) error {
	if _, ok := f.plants[id]; !ok {
		return store.ErrNotFound
	}
	delete(f.plants, id)
	for mid, m := range f.media {
		if m.PlantID == id {
			delete(f.media, mid)
		}
	}
	return nil
}

func (f *fakeStore) WaterPlant(_ context.Context, id uuid.UUID, on *string) (store.Plant, error) {
	p, ok := f.plants[id]
	if !ok {
		return store.Plant{}, store.ErrNotFound
	}
	day := time.Now().UTC().Format(time.DateOnly)
	if on != nil {
		day = *on
	}
	f.waterings[id] = append(f.waterings[id], store.Watering{ID: uuid.New(), PlantID: id, WateredOn: day})
	p.LastWateredOn, p.DaysUntilWater = day, p.WaterEveryDays
	f.plants[id] = p
	return p, nil
}

func (f *fakeStore) CreateMedia(_ context.Context, m store.Media) (store.Media, error) {
	if f.createMediaErr != nil {
		return store.Media{}, f.createMediaErr
	}
	if _, ok := f.plants[m.PlantID]; !ok {
		return store.Media{}, store.ErrNotFound
	}
	m.CreatedAt = time.Now()
	f.media[m.ID] = m
	return m, nil
}

func (f *fakeStore) GetMedia(_ context.Context, id uuid.UUID) (store.Media, error) {
	m, ok := f.media[id]
	if !ok {
		return store.Media{}, store.ErrNotFound
	}
	return m, nil
}

func (f *fakeStore) ListMediaForPlant(_ context.Context, plantID uuid.UUID) ([]store.Media, error) {
	out := []store.Media{}
	for _, m := range f.media {
		if m.PlantID == plantID {
			out = append(out, m)
		}
	}
	return out, nil
}

func (f *fakeStore) DeleteMedia(_ context.Context, id uuid.UUID) error {
	if _, ok := f.media[id]; !ok {
		return store.ErrNotFound
	}
	delete(f.media, id)
	return nil
}

// ---- in-memory FileStorage ----

type fakeFiles struct {
	objects   map[string][]byte
	putErr    error
	deleteErr error
}

func newFakeFiles() *fakeFiles { return &fakeFiles{objects: map[string][]byte{}} }

func (f *fakeFiles) Put(_ context.Context, key string, body io.ReadSeeker, _ int64, _ string) error {
	if f.putErr != nil {
		return f.putErr
	}
	b, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	f.objects[key] = b
	return nil
}

func (f *fakeFiles) Get(_ context.Context, key string) (io.ReadCloser, error) {
	b, ok := f.objects[key]
	if !ok {
		return nil, storage.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

func (f *fakeFiles) Delete(_ context.Context, key string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	delete(f.objects, key)
	return nil
}

// ---- HTTP helpers ----

const testMaxUpload = 1024

var errBoom = errors.New("boom")

type env struct {
	e     *echo.Echo
	store *fakeStore
	files *fakeFiles
}

func newEnv() env {
	s, f := newFakeStore(), newFakeFiles()
	e := echo.New()
	New(s, f, testMaxUpload).Register(e)
	return env{e: e, store: s, files: f}
}

func (v env) do(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	if body != nil {
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	}
	rec := httptest.NewRecorder()
	v.e.ServeHTTP(rec, req)
	return rec
}

func (v env) upload(t *testing.T, path, filename, contentType string, content []byte, caption string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if filename != "" {
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
		h.Set("Content-Type", contentType)
		part, err := w.CreatePart(h)
		if err != nil {
			t.Fatal(err)
		}
		part.Write(content)
	}
	if caption != "" {
		w.WriteField("caption", caption)
	}
	w.Close()

	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set(echo.HeaderContentType, w.FormDataContentType())
	rec := httptest.NewRecorder()
	v.e.ServeHTTP(rec, req)
	return rec
}

func (v env) seedPlant(t *testing.T, name string) store.Plant {
	t.Helper()
	p, _ := v.store.CreatePlant(context.Background(), store.NewPlant{Name: name, WaterEveryDays: 7})
	return p
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func expectStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, want, rec.Body.String())
	}
}

func expectError(t *testing.T, rec *httptest.ResponseRecorder, want int, msgContains string) {
	t.Helper()
	expectStatus(t, rec, want)
	body := decode[map[string]string](t, rec)
	if !bytes.Contains([]byte(body["error"]), []byte(msgContains)) {
		t.Fatalf("error = %q, want it to contain %q", body["error"], msgContains)
	}
}
