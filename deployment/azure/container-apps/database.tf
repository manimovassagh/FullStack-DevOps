# No special characters: the password goes straight into a postgres:// URL.
resource "random_password" "db" {
  length  = 24
  special = false
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "${var.name}-db"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = "16"
  administrator_login    = "plantadmin"
  administrator_password = random_password.db.result
  sku_name               = "B_Standard_B1ms"
  storage_mb             = 32768
  zone                   = "1"

  # Floci does not store the zone and reports a different one, which the provider would try to change on every plan.
  lifecycle {
    ignore_changes = [zone]
  }
}

resource "azurerm_postgresql_flexible_server_database" "plant" {
  name      = "plant"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

locals {
  # On Azure the host is the server's fully qualified name and TLS is mandatory; the emulator serves plain TCP on a container address.
  db_host    = var.on_floci ? var.db_host : azurerm_postgresql_flexible_server.main.fqdn
  db_sslmode = var.on_floci ? "disable" : "require"
  # floci-az records databases as metadata only (no CREATE DATABASE runs), so locally the backend uses the default
  # `postgres` database, which always exists; its migrations create the tables. On Azure it uses the database above.
  db_name      = var.on_floci ? "postgres" : azurerm_postgresql_flexible_server_database.plant.name
  database_url = "postgres://${azurerm_postgresql_flexible_server.main.administrator_login}:${random_password.db.result}@${local.db_host}:5432/${local.db_name}?sslmode=${local.db_sslmode}"
}
