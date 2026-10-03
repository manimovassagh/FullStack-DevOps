output "app_url" {
  description = "Open this in the browser: the gateway Cloud Run service."
  value       = google_cloud_run_v2_service.gateway.uri
}

output "media_bucket" {
  value = google_storage_bucket.media.name
}

output "latest_ready_revisions" {
  description = "The revision each service serves; changes when a new image tag is deployed."
  value = {
    backend  = google_cloud_run_v2_service.backend.latest_ready_revision
    frontend = google_cloud_run_v2_service.frontend.latest_ready_revision
    gateway  = google_cloud_run_v2_service.gateway.latest_ready_revision
  }
}

output "database_connection_name" {
  value = google_sql_database_instance.main.connection_name
}
