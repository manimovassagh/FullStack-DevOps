# Google Cloud Run + Cloud SQL + Cloud Storage on the Floci GCP emulator. Run from this directory.
SHELL := /bin/bash
ROOT  := $(abspath ../../..)
SMOKE := ../../smoke

# floci-gcp ignores credentials; the google provider just needs some token.
export GOOGLE_OAUTH_ACCESS_TOKEN ?= fake-token
export FLOCI_ENDPOINT := http://localhost:4588
# Read by ../../smoke/api-smoke.sh: how to list objects in this stage's bucket (not S3).
export SMOKE_LIST_OBJECTS := $(CURDIR)/scripts/list-objects.sh

# Image tag = git commit (+ -dirty for uncommitted changes); override with IMAGE_TAG=...
IMAGE_TAG := $(or $(IMAGE_TAG),$(shell git rev-parse --short HEAD)$(shell git diff --quiet HEAD -- $(ROOT)/backend-gcp $(ROOT)/frontend $(CURDIR)/gateway || echo -dirty))
export TF_VAR_image_tag := $(IMAGE_TAG)

WAIT_TRIES ?= 60 # × 5 s

.PHONY: floci init images deploy up wait rollout plan check smoke logs destroy forget

floci: ## start this stage's Floci GCP emulator (its own compose file)
	docker compose up -d --wait

init:
	terraform init

images: ## build the three images locally; Cloud Run starts them straight from the Docker daemon
	docker build -t plant/backend-gcp:$(IMAGE_TAG) $(ROOT)/backend-gcp
	docker build -t plant/frontend:$(IMAGE_TAG) $(ROOT)/frontend
	docker build -t plant/gcp-gateway:$(IMAGE_TAG) gateway

deploy: ## terraform apply for $(IMAGE_TAG)
	terraform apply -auto-approve -input=false

up: floci init images deploy wait

apiurl = $$(terraform output -raw app_url)

wait: ## block until the app answers through the gateway (page + API)
	@for i in $$(seq 1 $(WAIT_TRIES)); do \
		curl -sf "$(apiurl)/api/health" | grep -q '"ok"' && curl -sf "$(apiurl)/" | grep -qi '<div id="root">' && { echo "healthy: $(apiurl)"; exit 0; }; \
		sleep 5; \
	done; echo "not healthy after $(WAIT_TRIES) tries: $(apiurl)"; $(MAKE) -s logs; exit 1

revisions = terraform output -json latest_ready_revisions | jq -c .

rollout: ## release test: same images under a new tag; every service moves to a new revision, the old container stops, the API smoke test passes
	@set -e; before=$$($(revisions)); echo "revisions before: $$before"; \
	for img in backend-gcp frontend gcp-gateway; do docker tag plant/$$img:$(IMAGE_TAG) plant/$$img:$(IMAGE_TAG)-rollout; done; \
	$(MAKE) -s deploy IMAGE_TAG=$(IMAGE_TAG)-rollout >/dev/null; $(MAKE) -s wait >/dev/null; \
	after=$$($(revisions)); echo "revisions after:  $$after"; \
	jq -en --argjson a "$$before" --argjson b "$$after" '$$a|to_entries|all(.value != $$b[.key])' >/dev/null || { echo "FAIL: not every service moved to a new revision"; exit 1; }; \
	for svc in backend frontend gateway; do n=$$(docker ps --format '{{.Names}}' | grep -c "cloudrun-$$svc-"); [ "$$n" = 1 ] || { echo "FAIL: $$n containers for $$svc (the old revision should have stopped)"; exit 1; }; done; \
	$(SMOKE)/api-smoke.sh "$(apiurl)" "$$(terraform output -raw media_bucket)" | tail -1

plan:
	terraform plan

check: ## idempotency: after an apply, a plan must show no changes (exit 0)
	terraform plan -detailed-exitcode -input=false

smoke: ## API + browser smoke tests through the gateway (shared with every deployment style)
	$(SMOKE)/api-smoke.sh "$(apiurl)" "$$(terraform output -raw media_bucket)"
	cd $(SMOKE) && npm ci --silent && npx playwright install chromium >/dev/null \
		&& SMOKE_STAGE=gcp-cloud-run SMOKE_BASE_URL="$$(cd $(CURDIR) && terraform output -raw app_url)" npx playwright test

logs: ## output of the Cloud Run containers, including ones that exited (Floci keeps it in Docker, not Cloud Logging)
	@docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -i 'floci-gcp-'
	@for c in $$(docker ps -a --format '{{.Names}}' | grep -i -E 'floci-gcp-(cloudrun|cloudsql)'); do echo "== $$c"; docker logs --tail 30 $$c 2>&1; done

destroy: ## empty the bucket first, then terraform destroy, then stop the emulator
	-@scripts/empty-bucket.sh "$$(terraform output -raw media_bucket 2>/dev/null)" 2>/dev/null
	terraform destroy -auto-approve
	docker compose down

forget: ## the emulator was restarted and lost everything: drop the stale state
	rm -f terraform.tfstate terraform.tfstate.backup
