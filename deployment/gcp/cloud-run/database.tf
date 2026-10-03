# No special characters: the password goes straight into a postgres:// URL.
resource "random_password" "db" {
  length  = 24
  special = false
}

resource "google_sql_database_instance" "main" {
  name                = "${var.name}-db"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = false

  settings {
    tier = "db-custom-1-3840"

    # On Google Cloud: TLS is mandatory and, when you pass a VPC, the instance gets no public address.
    # floci-gcp serves plain TCP on a container address, so these are skipped locally.
    dynamic "ip_configuration" {
      for_each = var.on_floci ? [] : [1]
      content {
        ssl_mode        = "ENCRYPTED_ONLY"
        ipv4_enabled    = var.private_network_id == null
        private_network = var.private_network_id
      }
    }
  }
}

resource "google_sql_database" "plant" {
  name     = "plant"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "plant" {
  name     = "plant"
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
}

locals {
  # floci-gcp keeps the Postgres admin login fixed (postgres/postgres) and records users only as metadata,
  # so locally the backend logs in as that admin. On Google Cloud it uses the dedicated user created above.
  db_user     = var.on_floci ? "postgres" : google_sql_user.plant.name
  db_password = var.on_floci ? "postgres" : random_password.db.result

  # TCP to the instance's address. On real Google Cloud you would use the Cloud SQL connection
  # (a unix socket under /cloudsql, or the connector) instead of a plain host; floci-gcp has no such volume.
  database_url = "postgres://${local.db_user}:${local.db_password}@${google_sql_database_instance.main.ip_address[0].ip_address}:5432/${google_sql_database.plant.name}?sslmode=disable"
}

# The connection string, kept in Secret Manager. On real Google Cloud the backend reads it through
# `value_source.secret_key_ref` (see run.tf); floci-gcp cannot inject secrets into containers, so locally it is a plain env var.
resource "google_secret_manager_secret" "database_url" {
  secret_id = "${var.name}-database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = local.database_url
}
