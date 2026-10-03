# backend-gcp

The Plant Parent API for Google Cloud: a copy of [`../backend`](../backend) whose photo storage uses **Google Cloud Storage** (the `cloud.google.com/go/storage` client) instead of S3. Everything else (routes, handlers, Postgres store, migrations) is unchanged. It is deployed by [`../deployment/gcp/cloud-run`](../deployment/gcp/cloud-run).

Why a copy: `backend/` serves every AWS stage and stays as it is. The differences are small and all in storage and config:

- `internal/storage/gcs.go` implements the same `FileStorage` interface as `s3.go` in `backend/` (`Put`, `Get`, `Delete`, `ErrNotFound`).
- `internal/config` reads `GCS_BUCKET` instead of `S3_BUCKET` / `AWS_*`. The client library finds credentials by itself (the Cloud Run service account) and honours `STORAGE_EMULATOR_HOST` for the Floci GCP emulator, so no emulator code lives in the app.

```bash
go test ./...   # the Cloud Storage round-trip runs when STORAGE_EMULATOR_HOST and GCS_BUCKET are set
```
