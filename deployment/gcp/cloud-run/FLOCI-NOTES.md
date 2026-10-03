# Floci GCP notes for the gcp-cloud-run stage

Verified against `floci/floci-gcp:0.9.0` (pinned in [compose.yaml](compose.yaml)). Cloud Run and Cloud SQL run as real Docker containers; Cloud Storage and Secret Manager are in-process.

## What works like real Google Cloud

- **Cloud Run revisions.** Each service template starts a container with `PORT`, `K_SERVICE`, `K_REVISION` injected; a template change creates a new revision, and the old container is stopped once the new one is ready.
- **Cloud SQL runs a real Postgres** (`postgres:16`) on the compose network; Terraform sees an address and a `RUNNABLE` instance.
- **Cloud Storage** through the JSON API (what the client library uses), with `STORAGE_EMULATOR_HOST`.
- **Terraform** with the `hashicorp/google` provider and `*_custom_endpoint` settings (see `providers.tf`).

## Differences, and what this stage does about them

- **S3-style Cloud Storage uploads don't work.** Real Cloud Storage accepts S3 clients (HMAC keys), but the emulator answers an S3-style `PUT` with a JSON body where Google returns an empty one, and the AWS SDK rejects it. That is why this stage uses `backend-gcp` with the native client instead of the unchanged backend.
- **Generated hostnames only resolve on your machine.** Service URLs look like `http://backend-<id>.us-central1.run.localhost.floci.io:4588`; inside containers that name resolves to 127.0.0.1 (the containers use Docker's resolver, not the emulator's). The gateway therefore connects to the emulator by its compose name (`floci-gcp:4588`) and sets the `Host` header to the target's generated host, which is what the emulator routes on. On Google Cloud it proxies to the real `https://…run.app` URL.
- **The emulator's front door rejects `Expect: 100-continue`.** curl sends it for uploads over 1 MB, and the request fails with a 500 before it reaches any container; browsers never send it. The shared smoke test's upload passes `-H 'Expect:'`.
- **Cloud SQL users are metadata.** The Postgres container keeps a fixed admin login (`postgres`/`postgres`) and does not create the user from `google_sql_user`, so locally the backend logs in as that admin (`on_floci`). On Google Cloud it uses the dedicated user. Cloud SQL TLS and private addressing (`database.tf`, `private_network_id`) are for real Google Cloud only: the emulator serves plain TCP on a container address.
- **No secret injection into containers.** `value_source.secret_key_ref` is not supported, so locally `DATABASE_URL` is a plain env var; the secret itself is still created.
- **No load-balancer routing.** The compute emulator stores URL maps and backend services but does not route; hence the gateway.
- **A few attributes are not stored** and would show as plan changes: `uniform_bucket_level_access` (in `ignore_changes`), provider `default_labels` (not used here).
- **Same tag, rebuilt image:** Cloud Run only starts a new revision when the service template changes, so rebuilding an image under the same tag does not redeploy it locally. Use a new `IMAGE_TAG` while iterating; CI always builds from committed code.
