# azure-container-apps: Container Apps + PostgreSQL Flexible Server

The Plant Parent app on Azure's most common serverless container setup, running locally on the [Floci Azure emulator](https://github.com/floci-io/floci-az). Three Container Apps (gateway, backend, frontend) and a PostgreSQL Flexible Server. The repo's backend and frontend images are used **unchanged**.

```
Browser ─► gateway (Container App, nginx) ─┬─ /api/* ─► backend  (Container App, Go) ─► PostgreSQL Flexible Server
                                           │                                         └► S3-compatible object store (photos)
                                           └─ /*     ─► frontend (Container App, nginx + React build)
```

On real Azure only the gateway has external ingress; the backend and frontend are internal. Photos: the backend speaks the S3 API only and Azure Blob has no S3 interface, so an S3-compatible store (Floci's S3, in this stage's compose file) holds them. See the notes below.

## Run it

    cd deployment/azure/container-apps
    make up          # emulator + object store + trust its certificate + images + terraform apply + wait
    make smoke       # shared API + browser tests through the gateway
    make rollout     # new image tag → new revisions of all three apps, API smoke
    make destroy

Needs Docker, the AWS CLI (to create the bucket), Go, Node 22 and `jq`. Terraform itself runs in a container (`hashicorp/terraform`), so you do not need it installed.

## Files

| File | Concern |
|---|---|
| `apps.tf` | the Container Apps environment and three `azurerm_container_app` (revisions, ingress, secrets, env, scale) |
| `database.tf` | PostgreSQL Flexible Server, database, and the connection string |
| `storage.tf` | the S3-compatible photo store's keys (the store itself is in `compose.yaml`) |
| `resource_group.tf` | the resource group everything lives in |
| `gateway/` | nginx that routes `/api/*` to the backend and the rest to the frontend |
| `compose.yaml` | the emulator (TLS on) and the object store |
| `scripts/` | container address lookup, the app URL, revision lookup for the release test |

## What you learn

- **Container Apps:** an *environment* hosts apps; an app is containers + ingress + scale; every template change makes a numbered **revision** (`backend--000004` → `--000005`), and in `Single` revision mode the new one replaces the old.
- **Secrets as app secrets:** the DB URL and the store keys are declared as app `secret`s and reach the container through `secret_name` env references.
- **Ingress:** `external_enabled` decides whether an app is reachable from outside the environment; only the gateway is.
- **Flexible Server:** a managed Postgres with an administrator login, SKU and storage size; its `fqdn` is what apps connect to (with TLS on Azure).
- **The azurerm provider** with a custom cloud: `metadata_host` points it at the emulator, and the provider insists on HTTPS (see the notes).

## Real Azure

Delete `metadata_host`, `environment` and the fake credentials in `providers.tf`, set `on_floci = false`, and `az login`. Then the backend connects to the server's FQDN with TLS, the backend and frontend use internal ingress behind the gateway, and nothing in the images changes. Replace the object store with a store your backend can use (another container app running an S3-compatible service, or a backend that talks to Blob).

Floci specifics, and why Terraform runs in a container: [FLOCI-NOTES.md](FLOCI-NOTES.md).
