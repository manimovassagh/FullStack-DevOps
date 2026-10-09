# ECS (Fargate) API behind an ALB that only CloudFront may use; the React build in S3 behind the same CloudFront.
# On this stage's own Floci (see compose.yaml). Run from this directory.
SHELL := /bin/bash
ROOT  := $(abspath ../../..)
SMOKE := ../../smoke

export AWS_ACCESS_KEY_ID     ?= test
export AWS_SECRET_ACCESS_KEY ?= test
export AWS_REGION            ?= us-east-1
FLOCI := http://localhost:4571
AWS   := aws --endpoint-url $(FLOCI)
# Read by ../../smoke/api-smoke.sh.
export FLOCI_ENDPOINT := $(FLOCI)

# Image tag = git commit (+ -dirty for uncommitted changes); override with IMAGE_TAG=...
# Evaluated once (:=), so images/push/deploy in one run always agree even if HEAD moves.
IMAGE_TAG := $(or $(IMAGE_TAG),$(shell git rev-parse --short HEAD)$(shell git diff --quiet HEAD -- $(ROOT)/backend || echo -dirty))
export TF_VAR_image_tag := $(IMAGE_TAG)
REGISTRY := 000000000000.dkr.ecr.$(AWS_REGION).localhost:4571

WAIT_TRIES ?= 72 # × 5 s

.PHONY: floci frontend site up init repos _repos images push deploy apply rollout plan check smoke health wait logs destroy forget

floci: ## start this stage's Floci (a nightly: CloudFront forwards POST/PUT/DELETE; see compose.yaml)
	docker compose up -d --wait

init:
	terraform init

repos: ## create the ECR repositories first, so images can be pushed before the services need them
	@# Right after an emulator restart Floci brings its stored ECR repositories back a few seconds late: retry once.
	@$(MAKE) -s _repos || { sleep 8; $(MAKE) -s _repos; }

_repos:
	@# Floci keeps ECR repositories across a restart while everything else is lost. If one is still there but not in
	@# this state, it is such a leftover: remove it so Terraform can create it again (the images are pushed right after).
	@for svc in backend; do \
		terraform state show 'aws_ecr_repository.app["'$$svc'"]' >/dev/null 2>&1 && continue; \
		$(AWS) ecr describe-repositories --repository-names plant-ecs-cf-$$svc >/dev/null 2>&1 || continue; \
		echo "removing leftover ECR repository plant-ecs-cf-$$svc from an earlier emulator run"; \
		$(AWS) ecr delete-repository --force --repository-name plant-ecs-cf-$$svc >/dev/null; \
	done
	terraform apply -auto-approve -target=aws_ecr_repository.app

images: ## build the backend image locally as plant/<svc>:$(IMAGE_TAG) (CI builds them in a separate job)
	for svc in backend; do docker build -t plant/$$svc:$(IMAGE_TAG) $(ROOT)/$$svc || exit 1; done

push: repos ## tag the local image for ECR and push it
	$(AWS) ecr get-login-password | docker login --username AWS --password-stdin $(REGISTRY) >/dev/null
	for svc in backend; do \
		docker tag plant/$$svc:$(IMAGE_TAG) $(REGISTRY)/plant-ecs-cf-$$svc:$(IMAGE_TAG) && \
		docker push -q $(REGISTRY)/plant-ecs-cf-$$svc:$(IMAGE_TAG) || exit 1; \
	done

deploy: ## terraform apply for the pushed $(IMAGE_TAG)
	terraform apply -auto-approve -input=false

apply: images push deploy

frontend: ## build the React app that is uploaded to the site bucket
	cd $(ROOT)/frontend && npm ci --silent && npm run build

site: ## upload the React build to the site bucket and invalidate CloudFront (a frontend release)
	d=$(ROOT)/frontend/dist; b=$$(terraform output -raw site_bucket); \
	$(AWS) s3 sync "$$d" "s3://$$b" --delete --exclude 'assets/*' --cache-control 'no-cache' --only-show-errors && \
	$(AWS) s3 sync "$$d/assets" "s3://$$b/assets" --delete --cache-control 'public, max-age=31536000, immutable' --only-show-errors && \
	$(AWS) cloudfront create-invalidation --distribution-id "$$(terraform output -raw distribution_id)" --paths '/*' --query Invalidation.Status --output text

up: floci init apply frontend site wait ## everything, from nothing to a working URL

revisions = $$($(AWS) ecs describe-services --cluster plant-ecs-cf --services backend \
	--query 'services[].taskDefinition' --output text | grep -o ':[0-9]*' | tr -d : | tr '\n' ' ')

rollout: ## deployment test: ship the same images under a new tag; expect new revisions, healthy targets, passing API smoke
	@# The image tag is the git commit: after new commits the deployed images carry an older tag, so build this commit's first.
	@before="$(revisions)"; echo "revisions before: $$before"; \
	for svc in backend; do { docker image inspect plant/$$svc:$(IMAGE_TAG) >/dev/null 2>&1 || $(MAKE) -s images IMAGE_TAG=$(IMAGE_TAG) >/dev/null || exit 1; } && docker tag plant/$$svc:$(IMAGE_TAG) plant/$$svc:$(IMAGE_TAG)-rollout; done; \
	$(MAKE) -s push deploy IMAGE_TAG=$(IMAGE_TAG)-rollout >/dev/null && $(MAKE) -s wait IMAGE_TAG=$(IMAGE_TAG)-rollout >/dev/null || exit 1; \
	after="$(revisions)"; echo "revisions after:  $$after"; \
	[ "$$before" != "$$after" ] || { echo "FAIL: task-definition revisions did not change"; exit 1; }; \
	SMOKE_ALLOW_SPA_FALLBACK=1 $(SMOKE)/api-smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)" | tail -1

plan:
	terraform plan

check: ## idempotency: after an apply, a plan must show no changes (exit 0)
	terraform plan -detailed-exitcode -input=false

# Floci cannot run the CloudFront Function, so a 404 page falls back to index.html (see FLOCI-NOTES.md).
smoke: export SMOKE_ALLOW_SPA_FALLBACK := 1
smoke: ## the ALB refuses everyone but CloudFront; API + browser smoke tests through CloudFront
	scripts/origin-lock.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw alb_url)"
	$(SMOKE)/api-smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)"
	cd $(SMOKE) && npm ci --silent && { [ -n "$$SMOKE_BROWSER_CHANNEL" ] || npx playwright install chromium >/dev/null; } \
		&& SMOKE_STAGE=ecs-cloudfront SMOKE_BASE_URL="$$(cd $(CURDIR) && terraform output -raw app_url)" npx playwright test

health: ## target health of both target groups
	@for tg in backend; do echo "$$tg:"; $(AWS) elbv2 describe-target-health \
		--target-group-arn "$$(terraform output -raw $${tg}_target_group_arn)" \
		--query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output text; done

wait: ## block until the backend target is healthy and the app answers through CloudFront (page + API)
	@url=$$(terraform output -raw app_url); for i in $$(seq 1 $(WAIT_TRIES)); do \
		out=$$($(MAKE) -s health); \
		echo "$$out" | grep -q healthy && [ -z "$$(echo "$$out" | grep -E 'unhealthy|initial|draining')" ] \
			&& curl -sf "$$url/api/health" | grep -q '"ok"' && curl -sf "$$url/" | grep -qi '<div id="root">' && { echo "$$out"; echo "healthy: $$url"; exit 0; }; \
		sleep 5; \
	done; echo "not healthy:"; $(MAKE) -s health; exit 1

logs: ## show the running task containers' output (Floci keeps logs in Docker, not CloudWatch)
	@for c in $$(docker ps --format '{{.Names}}' | grep -i -E 'ecs.*backend'); do echo "== $$c"; docker logs --tail 20 $$c; done

destroy: ## empty the bucket first: on Floci, the provider's force_destroy can loop forever on leftover objects
	-@for b in "$$(terraform output -raw media_bucket 2>/dev/null)" "$$(terraform output -raw site_bucket 2>/dev/null)"; do $(AWS) s3 rm "s3://$$b" --recursive --quiet 2>/dev/null; done
	terraform destroy -auto-approve

forget: ## Floci was restarted and lost everything: drop the stale state
	rm -f terraform.tfstate terraform.tfstate.backup
