# Serverless (Lambda + API Gateway + CloudFront + S3) deployment on Floci. Run from this directory.
SHELL := /bin/bash
ROOT  := $(abspath ../..)
SMOKE := ../smoke

export AWS_ACCESS_KEY_ID     ?= test
export AWS_SECRET_ACCESS_KEY ?= test
export AWS_REGION            ?= us-east-1
# This stage's own Floci, see compose.yaml.
FLOCI := http://localhost:4567
AWS   := aws --endpoint-url $(FLOCI)
# Read by ../smoke/api-smoke.sh.
export FLOCI_ENDPOINT := $(FLOCI)

# Floci runs functions on the Docker host's architecture, so build for that one.
HOST_ARCH := $(shell uname -m)
ifeq ($(HOST_ARCH),x86_64)
  export TF_VAR_lambda_architecture := x86_64
  GOARCH := amd64
else
  export TF_VAR_lambda_architecture := arm64
  GOARCH := arm64
endif

# Release label = git commit (+ -dirty); override with RELEASE=... A new label ships a new function version.
RELEASE := $(or $(RELEASE),$(shell git rev-parse --short HEAD)$(shell git diff --quiet HEAD -- $(ROOT)/backend-serverless $(ROOT)/frontend || echo -dirty))
export TF_VAR_release := $(RELEASE)

WAIT_TRIES ?= 60 # × 5 s

.PHONY: floci init lambda frontend deploy up rollout plan check smoke wait logs destroy forget

floci: ## start this stage's Floci (a nightly with CloudFront write-method support; see compose.yaml)
	docker compose up -d --wait

init:
	terraform init

lambda: ## build the function: one static Linux binary named `bootstrap`, zipped
	mkdir -p build
	cd $(ROOT)/backend-serverless && GOWORK=off CGO_ENABLED=0 GOOS=linux GOARCH=$(GOARCH) \
		go build -trimpath -tags lambda.norpc -ldflags='-s -w' -o $(CURDIR)/build/bootstrap ./cmd/lambda
	cd build && rm -f lambda.zip && zip -q -j lambda.zip bootstrap

frontend: ## build the React app that is uploaded to the site bucket
	cd $(ROOT)/frontend && npm ci --silent && npm run build

deploy: ## terraform apply (needs build/lambda.zip and frontend/dist)
	terraform apply -auto-approve -input=false

up: floci init lambda frontend deploy wait

apiurl = $$(terraform output -raw app_url)

wait: ## block until the app answers through CloudFront (page + API)
	@for i in $$(seq 1 $(WAIT_TRIES)); do \
		curl -sf "$(apiurl)/api/health" | grep -q '"ok"' && curl -sf "$(apiurl)/" | grep -qi '<div id="root">' && { echo "healthy: $(apiurl)"; exit 0; }; \
		sleep 5; \
	done; echo "not healthy after $(WAIT_TRIES) tries: $(apiurl)"; $(MAKE) -s logs; exit 1

release_header = curl -sI "$(apiurl)/api/health" | tr -d '\r' | awk -F': ' 'tolower($$1)=="x-release"{print $$2}'

rollout: ## deployment test: ship a new release; the function must answer with the new X-Release and the API must still pass its smoke test
	@before=$$($(release_header)); echo "release before: $$before"; \
	$(MAKE) -s deploy RELEASE=$(RELEASE)-rollout >/dev/null && $(MAKE) -s wait >/dev/null || exit 1; \
	after=$$($(release_header)); echo "release after:  $$after"; \
	[ -n "$$after" ] && [ "$$before" != "$$after" ] || { echo "FAIL: the live release did not change"; exit 1; }; \
	SMOKE_ALLOW_SPA_FALLBACK=1 $(SMOKE)/api-smoke.sh "$(apiurl)" "$$(terraform output -raw media_bucket)" | tail -1

plan:
	terraform plan

check: ## idempotency: after an apply, a plan must show no changes (exit 0)
	terraform plan -detailed-exitcode -input=false

# Floci cannot run the CloudFront Function; see FLOCI-NOTES.md.
smoke: export SMOKE_ALLOW_SPA_FALLBACK := 1
smoke: ## API + browser smoke tests through CloudFront (shared with every deployment style)
	$(SMOKE)/api-smoke.sh "$(apiurl)" "$$(terraform output -raw media_bucket)"
	cd $(SMOKE) && npm ci --silent && npx playwright install chromium >/dev/null \
		&& SMOKE_BASE_URL="$$(cd $(CURDIR) && terraform output -raw app_url)" npx playwright test

logs: ## the function's recent output (Floci keeps it in CloudWatch Logs)
	-@$(AWS) logs tail "/aws/lambda/$$(terraform output -raw function_name)" --since 15m 2>&1 | tail -40

destroy: ## empty both buckets first: on Floci, the provider's force_destroy can loop forever on leftover objects
	-@for b in "$$(terraform output -raw media_bucket 2>/dev/null)" "$$(terraform output -raw site_bucket 2>/dev/null)"; do $(AWS) s3 rm "s3://$$b" --recursive --quiet 2>/dev/null; done
	terraform destroy -auto-approve
	rm -rf build

forget: ## Floci was restarted and lost everything: drop the stale state
	rm -f terraform.tfstate terraform.tfstate.backup
