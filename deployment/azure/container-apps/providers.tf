# Every Azure Resource Manager call goes to the Floci Azure emulator: `metadata_host` makes the provider read its
# endpoints from there instead of from public Azure. On real Azure you would delete metadata_host, environment,
# the fake credentials and resource_provider_registrations, and sign in with `az login`.
provider "azurerm" {
  features {}

  resource_provider_registrations = "none"
  use_cli                         = false

  environment   = "stack"
  metadata_host = var.metadata_host

  subscription_id = "00000000-0000-0000-0000-000000000001"
  tenant_id       = "00000000-0000-0000-0000-000000000002"
  client_id       = "00000000-0000-0000-0000-000000000003"
  client_secret   = "fake-secret"
}
