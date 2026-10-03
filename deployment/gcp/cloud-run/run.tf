locals {
  # How the gateway reaches a service. On Google Cloud: its own https URL. On Floci: the generated host
  # (backend-<id>.us-central1.run.localhost.floci.io:4588) only resolves from your machine, not inside containers, so the
  # gateway connects to the emulator by its network name and sets the Host header to the service's generated host.
  upstream = {
    backend  = { url = var.on_floci ? "http://${var.emulator_host_in_network}" : google_cloud_run_v2_service.backend.uri, host = trimprefix(trimprefix(google_cloud_run_v2_service.backend.uri, "https://"), "http://") }
    frontend = { url = var.on_floci ? "http://${var.emulator_host_in_network}" : google_cloud_run_v2_service.frontend.uri, host = trimprefix(trimprefix(google_cloud_run_v2_service.frontend.uri, "https://"), "http://") }
  }

  images = {
    backend  = "plant/backend-gcp:${var.image_tag}"
    frontend = "plant/frontend:${var.image_tag}"
    gateway  = "plant/gcp-gateway:${var.image_tag}"
  }
}

# ── backend: the Go API (backend-gcp, which stores photos in Cloud Storage) ──
resource "google_cloud_run_v2_service" "backend" {
  name                = "backend"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.backend.email

    scaling {
      min_instance_count = 1
      max_instance_count = 2
    }

    containers {
      image = local.images.backend
      ports {
        container_port = 8080
      }

      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.media.name
      }

      # Locally: a plain env var (floci-gcp cannot inject secrets) and the emulator's storage host.
      dynamic "env" {
        for_each = var.on_floci ? { DATABASE_URL = local.database_url, STORAGE_EMULATOR_HOST = var.emulator_host_in_network } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      # On Google Cloud: DATABASE_URL comes from Secret Manager at instance start.
      dynamic "env" {
        for_each = var.on_floci ? [] : [1]
        content {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_version.database_url, google_storage_bucket_iam_member.backend_media]
}

# ── frontend: nginx with the React build ────────────────────────────────────
resource "google_cloud_run_v2_service" "frontend" {
  name                = "frontend"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 1
      max_instance_count = 2
    }
    containers {
      image = local.images.frontend
      ports {
        container_port = 80
      }
    }
  }
}

# ── gateway: nginx that sends /api/* to the backend and the rest to the frontend ──
# The stand-in for an external HTTPS load balancer with a URL map (floci-gcp stores load-balancer
# configuration but does not route requests). See FLOCI-NOTES.md.
resource "google_cloud_run_v2_service" "gateway" {
  name                = "gateway"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 1
      max_instance_count = 2
    }
    containers {
      image = local.images.gateway
      ports {
        container_port = 80
      }
      dynamic "env" {
        for_each = {
          BACKEND_URL   = local.upstream.backend.url
          BACKEND_HOST  = local.upstream.backend.host
          FRONTEND_URL  = local.upstream.frontend.url
          FRONTEND_HOST = local.upstream.frontend.host
        }
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }
}
