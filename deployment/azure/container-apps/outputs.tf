output "app_url" {
  description = "Open this in the browser: the gateway container app. On Floci the emulator's ingress listens on port 4577."
  value       = var.on_floci ? "http://${azurerm_container_app.gateway.ingress[0].fqdn}:4577" : "https://${azurerm_container_app.gateway.ingress[0].fqdn}"
}

output "media_bucket" {
  value = var.media_bucket
}

output "latest_revisions" {
  description = "The revision each app serves; changes when a new image tag is deployed."
  value = {
    backend  = azurerm_container_app.backend.latest_revision_name
    frontend = azurerm_container_app.frontend.latest_revision_name
    gateway  = azurerm_container_app.gateway.latest_revision_name
  }
}

output "database_server" {
  value = azurerm_postgresql_flexible_server.main.name
}
