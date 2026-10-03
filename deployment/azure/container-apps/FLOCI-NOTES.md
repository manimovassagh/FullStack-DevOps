# Floci Azure notes for the azure-container-apps stage

Verified against `floci/floci-az:0.13.0` (pinned in [compose.yaml](compose.yaml)). Container Apps and the PostgreSQL server run as real Docker containers when `FLOCI_AZ_SERVICES_CONTAINER_APPS_MOCKED=false`; ARM, the metadata endpoint and the OIDC bits are in-process.

## What works like real Azure

- **ARM through `hashicorp/azurerm` 4.x**: resource group, Container Apps environment, three container apps (`Single` revision mode, ingress, app secrets, env from secrets, min/max replicas), PostgreSQL Flexible Server and database.
- **Revisions**: a template change creates the next revision (`backend--000005`), starts a new replica container and retires the old one; `latestReadyRevisionName` follows.
- **PostgreSQL Flexible Server runs a real Postgres** (`postgres:17-alpine`) in a container named `floci-az-pg-<server>`.

## Differences, and what this stage does about them

- **The provider needs HTTPS, and macOS Go ignores `SSL_CERT_FILE`.** The azurerm provider discovers the cloud over `https://<metadata_host>/metadata/endpoints`. The emulator serves HTTP and HTTPS on the same port when `FLOCI_AZ_TLS_ENABLED=true` (a self-signed certificate at `/_floci/tls-cert`). Linux Go can be pointed at it with `SSL_CERT_FILE`, macOS Go cannot, so Terraform runs in a container that shares the emulator's network namespace (`--network container:plant-azure-floci-az`, so `localhost:4577` is the emulator) with a CA bundle (system roots + the emulator's certificate) from `make tls`. The same path runs on your machine and in CI.
- **Containers reach each other by IP, not by name.** The emulator and everything it starts live on Docker's default bridge, which has no DNS. `scripts/container-address.sh` looks up the PostgreSQL server's, the emulator's and the object store's addresses after they exist, and `make deploy` passes them to Terraform as variables (`db_host`, `emulator_address`, `s3_address`). That is also why `deploy` is two applies: the server first (its container must exist before its address can be read), then everything.
- **The app URL.** Hostnames like `gateway.plant-env.<hash>.localhost.floci.io` only resolve on your machine, so the gateway reaches the apps by connecting to the emulator's address and setting the `Host` header to the app's generated FQDN. The emulator's ingress also **hangs on reused connections**, which browsers use; so the stage opens the app on the gateway replica's own published port (`scripts/app-url.sh`), and nginx talks to the emulator with one connection per request. The Terraform output `app_url` (the emulator's ingress URL) works for one-off requests like `curl`.
- **Internal ingress is rejected.** Calls to an app with `external_enabled = false` return 404 even from another replica, so locally the backend and frontend are external too (`on_floci`). On Azure they are internal behind the gateway.
- **Databases are metadata only.** The emulator records `azurerm_postgresql_flexible_server_database` but never runs `CREATE DATABASE`, so locally the backend uses the default `postgres` database (its migrations create the tables). TLS is off locally (`sslmode=disable`); the server's `zone` is not stored (`ignore_changes`).
- **Secrets come back reordered**, which the provider would try to "fix" on every plan (`ignore_changes = [secret]` on the backend).
- **Log Analytics is skipped.** The emulator has no shared-keys API for workspaces, and the azurerm 3.x provider crashes on an environment without a log configuration, so this stage uses 4.x without a workspace. On Azure you would attach one.
- **Read revisions from the API, not Terraform state.** After an update the provider records the response before the new revision exists, so `terraform output` still shows the old revision name; `scripts/revisions.sh` asks the emulator.
- **Photo storage.** Azure Blob has no S3 interface, and the unchanged backend only speaks S3, so Floci's S3 (published on 4569 here) stands in as the object store.
