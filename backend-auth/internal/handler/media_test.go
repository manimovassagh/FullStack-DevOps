package handler

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/manimovassagh/FullStack-DevOps/backend-auth/internal/store"
)

func TestUploadMedia(t *testing.T) {
	v := newEnv()
	p := v.seedPlant(t, "Monstera")

	rec := v.upload(t, "/api/plants/"+p.ID.String()+"/media", "leaf.png", "image/png", []byte("fake png"), " new leaf! ")
	expectStatus(t, rec, http.StatusCreated)
	m := decode[store.Media](t, rec)

	if m.Filename != "leaf.png" || m.ContentType != "image/png" || m.SizeBytes != 8 || m.Caption != "new leaf!" {
		t.Errorf("got %+v", m)
	}
	if strings.Contains(rec.Body.String(), "s3_key") {
		t.Error("s3_key must not leak into the API response")
	}
	key := "plants/" + p.ID.String() + "/" + m.ID.String()
	if got := v.files.objects[key]; string(got) != "fake png" {
		t.Errorf("object %s = %q", key, got)
	}
}

func TestUploadMediaErrors(t *testing.T) {
	v := newEnv()
	p := v.seedPlant(t, "Monstera")
	path := "/api/plants/" + p.ID.String() + "/media"

	expectError(t, v.upload(t, "/api/plants/"+uuid.NewString()+"/media", "a.png", "image/png", []byte("x"), ""), http.StatusNotFound, "not found")
	expectError(t, v.upload(t, path, "", "", nil, "caption only"), http.StatusBadRequest, `"file" is required`)
	expectError(t, v.upload(t, path, "empty.txt", "text/plain", []byte{}, ""), http.StatusBadRequest, "empty")
	expectError(t, v.upload(t, path, "big.bin", "application/octet-stream", bytes.Repeat([]byte("x"), 2*testMaxUpload), ""), http.StatusRequestEntityTooLarge, "too large")

	v.files.putErr = errBoom
	expectError(t, v.upload(t, path, "a.png", "image/png", []byte("x"), ""), http.StatusInternalServerError, "internal error")
	if len(v.store.media) != 0 {
		t.Error("row inserted although S3 put failed")
	}
}

func TestUploadMediaCleansUpS3WhenInsertFails(t *testing.T) {
	v := newEnv()
	p := v.seedPlant(t, "Monstera")
	v.store.createMediaErr = errBoom

	expectStatus(t, v.upload(t, "/api/plants/"+p.ID.String()+"/media", "a.png", "image/png", []byte("x"), ""), http.StatusInternalServerError)
	if len(v.files.objects) != 0 {
		t.Errorf("orphaned objects left in storage: %v", v.files.objects)
	}
}

func TestDownloadMedia(t *testing.T) {
	v := newEnv()
	p := v.seedPlant(t, "Monstera")
	upload := func(name, ct string) store.Media {
		rec := v.upload(t, "/api/plants/"+p.ID.String()+"/media", name, ct, []byte("bytes of "+name), "")
		expectStatus(t, rec, http.StatusCreated)
		return decode[store.Media](t, rec)
	}

	png := upload("leaf.png", "image/png")
	rec := v.do(t, http.MethodGet, "/api/media/"+png.ID.String(), nil)
	expectStatus(t, rec, http.StatusOK)
	if rec.Body.String() != "bytes of leaf.png" || rec.Header().Get("Content-Type") != "image/png" {
		t.Errorf("body=%q type=%q", rec.Body.String(), rec.Header().Get("Content-Type"))
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "inline") || !strings.Contains(cd, "leaf.png") {
		t.Errorf("png Content-Disposition = %q", cd)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("missing nosniff")
	}

	// SVG can run scripts, so it must never render inline on our origin.
	svg := upload("logo.svg", "image/svg+xml")
	if cd := v.do(t, http.MethodGet, "/api/media/"+svg.ID.String(), nil).Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment") {
		t.Errorf("svg Content-Disposition = %q, want attachment", cd)
	}

	expectStatus(t, v.do(t, http.MethodGet, "/api/media/"+uuid.NewString(), nil), http.StatusNotFound)

	// Row exists but the object vanished from S3.
	delete(v.files.objects, "plants/"+p.ID.String()+"/"+png.ID.String())
	expectError(t, v.do(t, http.MethodGet, "/api/media/"+png.ID.String(), nil), http.StatusNotFound, "storage")
}

func TestDeleteMedia(t *testing.T) {
	v := newEnv()
	p := v.seedPlant(t, "Monstera")
	m := decode[store.Media](t, v.upload(t, "/api/plants/"+p.ID.String()+"/media", "a.pdf", "application/pdf", []byte("pdf"), ""))

	expectStatus(t, v.do(t, http.MethodDelete, "/api/media/"+m.ID.String(), nil), http.StatusNoContent)
	if len(v.files.objects) != 0 || len(v.store.media) != 0 {
		t.Errorf("leftovers: objects=%d rows=%d", len(v.files.objects), len(v.store.media))
	}
	expectStatus(t, v.do(t, http.MethodDelete, "/api/media/"+m.ID.String(), nil), http.StatusNotFound)
}
