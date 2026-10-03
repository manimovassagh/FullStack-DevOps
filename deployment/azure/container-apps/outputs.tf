output "app_url" {
  description = "Open this in the browser: the gateway container app. On Floci the emulator's ingress listens on port 4577."
  value       = var.on_floci ? "http://${azurerm_container_app.gateway.ingress[0].fqdn}:4577" : "https://${azurerm_container_app.gateway.ingress[0].fqdn}"
}

output "media_bucket" {
  value = var.media_bucket
}

output "database_server" {
  value = azurerm_postgresql_flexible_server.main.name
}
