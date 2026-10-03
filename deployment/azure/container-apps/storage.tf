# Photo storage. The backend speaks the S3 API only, and Azure Blob Storage has no S3-compatible interface, so the
# photos go to an S3-compatible object store (Floci's S3, started by compose.yaml; `make bucket` creates the bucket).
# A real Azure deployment would run such a store as another container app, or use a backend that talks to Blob natively.
locals {
  # The emulator accepts any keys.
  s3_access_key = "test"
  s3_secret_key = "test"
}
