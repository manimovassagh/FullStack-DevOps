# gcp-cloud-run: Cloud Run + Cloud SQL + Cloud Storage

The Plant Parent app on Google Cloud's most common container setup, running locally on the [Floci GCP emulator](https://github.com/floci-io/floci-gcp). Three Cloud Run services, a Cloud SQL Postgres instance and a Cloud Storage bucket.

```
Browser ─► gateway (Cloud Run, nginx) ─┬─ /api/* ─► backend  (Cloud Run, Go) ─► Cloud SQL Postgres
 http://gateway-<id>.us-central1.run.   │                                    └► Cloud Storage bucket (photos)
        localhost.floci.io:4588         └─ /*     ─► frontend (Cloud Run, nginx + React build)
```

The API is [`backend-gcp/`](../../../backend-gcp/) (the backend with Cloud Storage as photo storage; `backend/` is untouched). The frontend image is the repo's own.

## Run it

    cd deployment/gcp/cloud-run
    make up          # emulator (own compose file) + images + terraform apply + wait
    make smoke       # shared API + browser tests through the gateway
    make rollout     # new image tag → new revisions, old containers stopped, API smoke
    make destroy

Open the URL from `terraform output app_url`. Needs Docker, Terraform ≥ 1.14, Go, Node 22 and `jq`.

## Files

| File | Concern |
|---|---|
| `run.tf` | three `google_cloud_run_v2_service`: backend, frontend, gateway (images from the local Docker daemon) |
| `database.tf` | Cloud SQL instance, database, user, and the connection string in Secret Manager |
| `storage.tf` | the photos bucket |
| `iam.tf` | a service account for the backend (bucket + secret access only) and the public invoker role |
| `gateway/` | nginx that routes `/api/*` to the backend and the rest to the frontend |
| `compose.yaml` | this stage's own emulator (see [FLOCI-NOTES.md](FLOCI-NOTES.md)) |

## What you learn

- **Cloud Run:** a service is images + settings; every template change creates a numbered *revision*, traffic moves to the newest ready one, and the old one is stopped (`make rollout` asserts this).
- **Identity:** one service account per workload with only the roles it needs; public access is the explicit `allUsers` invoker binding.
- **Secrets:** the DB connection string lives in Secret Manager and reaches the container as an env var through `value_source.secret_key_ref` (on Google Cloud; see the notes for the local difference).
- **Storage from code:** the app uses the client library with no endpoint code; the emulator is selected by `STORAGE_EMULATOR_HOST` alone.
- **The gateway:** Cloud Run services are separate public URLs. The usual front door is an external HTTPS load balancer with a URL map and serverless NEGs; here a small nginx service plays that role (the emulator stores load-balancer config but does not route requests).

## Real Google Cloud

Delete the `custom_endpoint` lines in `providers.tf`, set `on_floci = false` and authenticate (`gcloud auth application-default login`). Then the backend reads the DB URL from Secret Manager, Cloud SQL requires TLS (and takes a private network via `private_network_id`), and nothing in the app changes.

Floci specifics: [FLOCI-NOTES.md](FLOCI-NOTES.md).
