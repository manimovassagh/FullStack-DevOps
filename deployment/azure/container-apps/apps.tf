resource "azurerm_container_app_environment" "main" {
  name                = "${var.name}-env"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

locals {
  images = {
    backend  = "plant/backend:${var.image_tag}"
    frontend = "plant/frontend:${var.image_tag}"
    gateway  = "plant/azure-gateway:${var.image_tag}"
  }

  # On Azure only the gateway is reachable from outside; the backend and frontend use internal ingress. floci-az rejects
  # calls to internal-ingress apps even from another replica (404), so locally they are external too.
  apps_external = var.on_floci

  # The unchanged backend reads these: the S3 API of the object store (endpoint + keys) and the bucket.
  s3_env = {
    AWS_ENDPOINT_URL = "http://${var.s3_address}:4566"
    AWS_REGION       = "us-east-1"
    S3_BUCKET        = var.media_bucket
  }
}

# ── backend: the Go API (the repo's backend, unchanged); internal ingress on Azure ──
resource "azurerm_container_app" "backend" {
  name                         = "backend"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single" # a new template replaces the old revision

  secret {
    name  = "database-url"
    value = local.database_url
  }
  secret {
    name  = "s3-access-key"
    value = local.s3_access_key
  }
  secret {
    name  = "s3-secret-key"
    value = local.s3_secret_key
  }

  template {
    min_replicas = 1
    max_replicas = 2

    container {
      name   = "backend"
      image  = local.images.backend
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "AWS_ACCESS_KEY_ID"
        secret_name = "s3-access-key"
      }
      env {
        name        = "AWS_SECRET_ACCESS_KEY"
        secret_name = "s3-secret-key"
      }
      dynamic "env" {
        for_each = local.s3_env
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  ingress {
    external_enabled = local.apps_external # internal on Azure; see locals
    target_port      = 8080
    transport        = "http"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  # floci-az returns the secrets in a different order than they were sent, which the provider would try to "fix" on every plan.
  lifecycle {
    ignore_changes = [secret]
  }

  depends_on = [azurerm_postgresql_flexible_server_database.plant]
}

# ── frontend: nginx with the React build; internal ingress on Azure ─────────
resource "azurerm_container_app" "frontend" {
  name                         = "frontend"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  template {
    min_replicas = 1
    max_replicas = 2

    container {
      name   = "frontend"
      image  = local.images.frontend
      cpu    = 0.25
      memory = "0.5Gi"
    }
  }

  ingress {
    external_enabled = local.apps_external
    target_port      = 80
    transport        = "http"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}

# ── gateway: the only app with external ingress; sends /api/* to the backend and the rest to the frontend ──
# The stand-in for Front Door or an Application Gateway (see FLOCI-NOTES.md).
locals {
  # How the gateway reaches an app. On Azure: its own https FQDN. On Floci: container names and the generated hostnames do not
  # resolve inside containers, so it connects to the emulator's address and sets the Host header to the app's generated FQDN,
  # which is what the emulator's ingress routes on.
  upstream_url = {
    backend  = var.on_floci ? "http://${var.emulator_address}:4577" : "https://${azurerm_container_app.backend.ingress[0].fqdn}"
    frontend = var.on_floci ? "http://${var.emulator_address}:4577" : "https://${azurerm_container_app.frontend.ingress[0].fqdn}"
  }
}

resource "azurerm_container_app" "gateway" {
  name                         = "gateway"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  template {
    min_replicas = 1
    max_replicas = 2

    container {
      name   = "gateway"
      image  = local.images.gateway
      cpu    = 0.25
      memory = "0.5Gi"

      dynamic "env" {
        for_each = {
          BACKEND_URL   = local.upstream_url.backend
          BACKEND_HOST  = azurerm_container_app.backend.ingress[0].fqdn
          FRONTEND_URL  = local.upstream_url.frontend
          FRONTEND_HOST = azurerm_container_app.frontend.ingress[0].fqdn
        }
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 80
    transport        = "http"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}
