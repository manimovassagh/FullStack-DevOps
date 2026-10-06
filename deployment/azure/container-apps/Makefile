# Azure Container Apps + PostgreSQL Flexible Server on the Floci Azure emulator. Run from this directory.
SHELL := /bin/bash
ROOT  := $(abspath ../../..)
SMOKE := ../../smoke

# The photos live in an S3-compatible store (Floci's S3), so the shared smoke test lists them with the AWS CLI against it.
export FLOCI_ENDPOINT         := http://localhost:4569
export AWS_ACCESS_KEY_ID      := test
export AWS_SECRET_ACCESS_KEY  := test

# Image tag = git commit (+ -dirty for uncommitted changes); override with IMAGE_TAG=...
IMAGE_TAG := $(or $(IMAGE_TAG),$(shell git rev-parse --short HEAD)$(shell git diff --quiet HEAD -- $(ROOT)/backend $(ROOT)/frontend $(CURDIR)/gateway || echo -dirty))

WAIT_TRIES ?= 60 # × 5 s

# Terraform runs in a container that shares the emulator's network namespace, so `localhost:4577` IS the emulator
# and its self-signed certificate (build/ca-bundle.pem: system roots + the emulator's) is trusted inside the
# container. Why not on the host: the azurerm provider requires HTTPS and macOS Go ignores SSL_CERT_FILE.
TF_IMAGE := hashicorp/terraform:1.14.6
EMULATOR := plant-azure-floci-az
TF = docker run --rm --network container:$(EMULATOR) -v $(CURDIR):/work -w /work \
	-e TF_DATA_DIR=/work/build/tfdata -e SSL_CERT_FILE=/work/build/ca-bundle.pem \
	-e TF_VAR_image_tag=$(IMAGE_TAG) -e TF_VAR_db_host -e TF_VAR_emulator_address -e TF_VAR_s3_address \
	$(TF_IMAGE)

# Container addresses on Docker's default bridge (looked up when a recipe needs them, passed to Terraform as variables).
addr = $$(scripts/container-address.sh $(1))
export_addrs = export TF_VAR_emulator_address=$(call addr,$(EMULATOR)) TF_VAR_s3_address=$(call addr,plant-azure-s3) TF_VAR_db_host=$(call addr,floci-az-pg-plant-db)

.PHONY: floci tls init images bucket deploy up wait rollout plan check smoke logs destroy forget

floci: ## start this stage's Floci Azure emulator (TLS on) and the object store (its own compose file)
	docker compose up -d --wait

tls: floci ## trust the emulator's self-signed certificate inside the Terraform container
	@mkdir -p build
	docker run --rm --entrypoint cat $(TF_IMAGE) /etc/ssl/certs/ca-certificates.crt > build/ca-bundle.pem
	curl -sf http://localhost:4577/_floci/tls-cert >> build/ca-bundle.pem

init: tls
	$(TF) init -input=false

images: ## build the three images locally; the emulator starts the replicas straight from the Docker daemon
	docker build -t plant/backend:$(IMAGE_TAG) $(ROOT)/backend
	docker build -t plant/frontend:$(IMAGE_TAG) $(ROOT)/frontend
	docker build -t plant/azure-gateway:$(IMAGE_TAG) gateway

bucket: ## create the photos bucket in the object store (idempotent)
	aws --endpoint-url $(FLOCI_ENDPOINT) --region us-east-1 s3api head-bucket --bucket plant-media 2>/dev/null \
		|| aws --endpoint-url $(FLOCI_ENDPOINT) --region us-east-1 s3api create-bucket --bucket plant-media >/dev/null

deploy: bucket ## terraform apply: the database first (its container's address is needed), then everything
	$(TF) apply -auto-approve -input=false -target=azurerm_postgresql_flexible_server.main
	$(export_addrs); $(TF) apply -auto-approve -input=false

up: floci init images deploy wait

# Where to open the app: the gateway replica's published port (see scripts/app-url.sh for why not the emulator's ingress URL).
apiurl = $$(scripts/app-url.sh)

wait: ## block until the app answers through the gateway (page + API)
	@for i in $$(seq 1 $(WAIT_TRIES)); do \
		curl -sf "$(apiurl)/api/health" | grep -q '"ok"' && curl -sf "$(apiurl)/" | grep -qi '<div id="root">' && { echo "healthy: $(apiurl)"; exit 0; }; \
		sleep 5; \
	done; echo "not healthy after $(WAIT_TRIES) tries: $(apiurl)"; $(MAKE) -s logs; exit 1

revisions = scripts/revisions.sh

rollout: ## release test: same images under a new tag; every app moves to a new revision, replicas keep running, the API smoke test passes
	@set -e; before=$$($(revisions)); echo "revisions before: $$before"; \
	for img in backend frontend azure-gateway; do docker tag plant/$$img:$(IMAGE_TAG) plant/$$img:$(IMAGE_TAG)-rollout; done; \
	$(MAKE) -s deploy IMAGE_TAG=$(IMAGE_TAG)-rollout >/dev/null; $(MAKE) -s wait >/dev/null; \
	after=$$($(revisions)); echo "revisions after:  $$after"; \
	jq -en --argjson a "$$before" --argjson b "$$after" '$$a|to_entries|all(.value != $$b[.key])' >/dev/null || { echo "FAIL: not every app moved to a new revision"; exit 1; }; \
	$(SMOKE)/api-smoke.sh "$(apiurl)" plant-media | tail -1

plan:
	$(export_addrs); $(TF) plan -input=false

check: ## idempotency: after an apply, a plan must show no changes (exit 0)
	$(export_addrs); $(TF) plan -detailed-exitcode -input=false

smoke: ## API + browser smoke tests through the gateway (shared with every deployment style)
	$(SMOKE)/api-smoke.sh "$(apiurl)" plant-media
	cd $(SMOKE) && npm ci --silent && { [ -n "$$SMOKE_BROWSER_CHANNEL" ] || npx playwright install chromium >/dev/null; } \
		&& SMOKE_STAGE=azure-container-apps SMOKE_BASE_URL="$$(cd $(CURDIR) && scripts/app-url.sh)" npx playwright test

logs: ## recent output of the app replicas and the database (Floci keeps them in Docker, not Log Analytics)
	@for c in $$(docker ps --format '{{.Names}}' | grep -E 'floci-az-(ca|pg)-'); do echo "== $$c"; docker logs --tail 15 $$c 2>&1; done

destroy: ## empty the bucket, terraform destroy, then stop the emulator and the object store
	-@aws --endpoint-url $(FLOCI_ENDPOINT) --region us-east-1 s3 rm s3://plant-media --recursive --quiet 2>/dev/null
	$(export_addrs); $(TF) destroy -auto-approve -input=false
	docker compose down
	rm -rf build

forget: ## the emulator was restarted and lost everything: drop the stale state
	rm -f terraform.tfstate terraform.tfstate.backup
