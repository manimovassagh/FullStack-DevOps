# One service account per workload: the backend may use the media bucket and read the DB secret; nobody else gets anything.
resource "google_service_account" "backend" {
  account_id   = "${var.name}-backend"
  display_name = "Plant Parent backend (Cloud Run)"
}

resource "google_storage_bucket_iam_member" "backend_media" {
  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_secret_manager_secret_iam_member" "backend_db" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend.email}"
}

# Public invoker. The gateway is the public entrance; the backend and frontend are public too because
# a Cloud Run service cannot call another one anonymously otherwise (on real Google Cloud, put an
# external HTTPS load balancer with serverless NEGs in front instead of a gateway; see the README).
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = {
    gateway  = google_cloud_run_v2_service.gateway.name
    backend  = google_cloud_run_v2_service.backend.name
    frontend = google_cloud_run_v2_service.frontend.name
  }
  location = var.region
  name     = each.value
  role     = "roles/run.invoker"
  member   = "allUsers"
}
