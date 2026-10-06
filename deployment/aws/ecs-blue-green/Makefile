# ECS blue/green + canary releases on Floci. Run from this directory.
SHELL := /bin/bash
ROOT  := $(abspath ../../..)
SMOKE := ../../smoke

export AWS_ACCESS_KEY_ID     ?= test
export AWS_SECRET_ACCESS_KEY ?= test
export AWS_REGION            ?= us-east-1
FLOCI := http://localhost:4566
AWS   := aws --endpoint-url $(FLOCI)

# Image tag = git commit (+ -dirty for uncommitted changes); override with IMAGE_TAG=...
# Evaluated once (:=), so images/push/deploy in one run always agree even if HEAD moves.
IMAGE_TAG := $(or $(IMAGE_TAG),$(shell git rev-parse --short HEAD)$(shell git diff --quiet HEAD -- $(ROOT)/backend $(ROOT)/frontend || echo -dirty))
REGISTRY := 000000000000.dkr.ecr.$(AWS_REGION).localhost:4566

WAIT_TRIES ?= 72 # × 5 s
STATE := release.auto.tfvars.json
RELEASE := scripts/release.sh

.PHONY: init repos _repos images push deploy up release preview canary promote rollback finalize abort status plan check smoke health wait sample rollout logs destroy forget

init:
	terraform init

repos: ## create the ECR repositories first, so images can be pushed before the services need them
	@# Right after an emulator restart Floci brings its stored ECR repositories back a few seconds late: retry once.
	@$(MAKE) -s _repos || { sleep 8; $(MAKE) -s _repos; }

_repos:
	@# Floci keeps ECR repositories across a restart while everything else is lost. If one is still there but not in
	@# this state, it is such a leftover: remove it so Terraform can create it again (the images are pushed right after).
	@for svc in backend frontend; do \
		terraform state show 'aws_ecr_repository.app["'$$svc'"]' >/dev/null 2>&1 && continue; \
		$(AWS) ecr describe-repositories --repository-names plant-ecs-bg-$$svc >/dev/null 2>&1 || continue; \
		echo "removing leftover ECR repository plant-ecs-bg-$$svc from an earlier emulator run"; \
		$(AWS) ecr delete-repository --force --repository-name plant-ecs-bg-$$svc >/dev/null; \
	done
	terraform apply -auto-approve -input=false -target=aws_ecr_repository.app -var blue_tag=$(IMAGE_TAG)

images: ## build both images locally as plant/<svc>:$(IMAGE_TAG) (CI builds them in a separate job)
	for svc in backend frontend; do docker build -t plant/$$svc:$(IMAGE_TAG) $(ROOT)/$$svc || exit 1; done

push: repos ## tag the local images for ECR and push them
	$(AWS) ecr get-login-password | docker login --username AWS --password-stdin $(REGISTRY) >/dev/null
	for svc in backend frontend; do \
		docker tag plant/$$svc:$(IMAGE_TAG) $(REGISTRY)/plant-ecs-bg-$$svc:$(IMAGE_TAG) && \
		docker push -q $(REGISTRY)/plant-ecs-bg-$$svc:$(IMAGE_TAG) || exit 1; \
	done

deploy: ## terraform apply the current release state
	terraform apply -auto-approve -input=false

up: push ## first deploy: blue runs $(IMAGE_TAG) with 100% of the traffic, green is off
	$(RELEASE) init $(IMAGE_TAG)
	$(MAKE) -s deploy wait

# ── The release flow ───────────────────────────────────────────────────────
release: ## TAG=<tag>  start green on <tag> with 0% of user traffic (reachable on the preview port)
	@[ -n "$(TAG)" ] || { echo "usage: make release TAG=<image tag>"; exit 1; }
	$(MAKE) -s push IMAGE_TAG=$(TAG)
	$(RELEASE) release $(TAG)
	$(MAKE) -s deploy wait

preview: ## API smoke test against green only (the preview listener), before it has user traffic
	$(SMOKE)/api-smoke.sh "$$(terraform output -raw preview_url)" "$$(terraform output -raw media_bucket)"

canary: ## PCT=<0-100>  send that share of user traffic to green
	@[ -n "$(PCT)" ] || { echo "usage: make canary PCT=10"; exit 1; }
	$(RELEASE) canary $(PCT)
	$(MAKE) -s deploy

promote: ## 100% of the traffic to green (blue keeps running, so rollback is instant)
	$(RELEASE) promote
	$(MAKE) -s deploy

rollback: ## all traffic back to blue
	$(RELEASE) rollback
	$(MAKE) -s deploy

finalize: ## make the new version the stable one: blue takes green's tag, then green is switched off
	$(RELEASE) finalize-1
	$(MAKE) -s deploy wait
	$(RELEASE) finalize-2
	$(MAKE) -s deploy wait

abort: ## drop an unpromoted candidate (green must have 0% of the traffic)
	$(RELEASE) abort
	$(MAKE) -s deploy

status: ## the release state and the health of every target group
	@$(RELEASE) show; $(MAKE) -s health

plan:
	terraform plan

check: ## idempotency: after an apply, a plan must show no changes (exit 0)
	terraform plan -detailed-exitcode -input=false

smoke: ## API + browser smoke tests through the public listener (shared with every deployment style)
	$(SMOKE)/api-smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)"
	cd $(SMOKE) && npm ci --silent && { [ -n "$$SMOKE_BROWSER_CHANNEL" ] || npx playwright install chromium >/dev/null; } \
		&& SMOKE_STAGE=ecs-blue-green SMOKE_BASE_URL="$$(cd $(CURDIR) && terraform output -raw app_url)" npx playwright test

sample: ## N=<requests>  send requests through the ALB and count which environment served them
	@scripts/served-by.sh $(or $(N),20)

rollout: ## release test: release → preview → canary → promote → rollback → promote → finalize, asserting where the traffic goes
	IMAGE_TAG=$(IMAGE_TAG) scripts/rollout-test.sh

health: ## target health of every target group
	@for k in $$(terraform output -json target_group_arns | jq -r 'keys[]'); do echo "$$k:"; \
		$(AWS) elbv2 describe-target-health --target-group-arn "$$(terraform output -json target_group_arns | jq -r --arg k $$k '.[$$k]')" \
		--query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output text; done

wait: ## block until every running environment's target groups have only healthy targets
	@keys="blue-frontend blue-backend"; [ "$$(jq -r .green_count $(STATE))" -gt 0 ] && keys="$$keys green-frontend green-backend"; \
	for i in $$(seq 1 $(WAIT_TRIES)); do ok=1; \
		for k in $$keys; do \
			out=$$($(AWS) elbv2 describe-target-health --target-group-arn "$$(terraform output -json target_group_arns | jq -r --arg k $$k '.[$$k]')" \
				--query 'TargetHealthDescriptions[].TargetHealth.State' --output text); \
			echo "$$out" | grep -q healthy && ! echo "$$out" | grep -qE 'unhealthy|initial|draining' || ok=0; \
		done; \
		[ $$ok = 1 ] && { echo "healthy: $$keys"; exit 0; }; \
		sleep 5; \
	done; echo "targets not healthy:"; $(MAKE) -s health; exit 1

logs: ## the running task containers' output (Floci keeps logs in Docker, not CloudWatch)
	@for c in $$(docker ps --format '{{.Names}}' | grep -i -E 'ecs'); do echo "== $$c"; docker logs --tail 5 $$c 2>&1; done

destroy: ## empty the bucket first: on Floci, the provider's force_destroy can loop forever on leftover objects
	-@$(AWS) s3 rm "s3://$$(terraform output -raw media_bucket 2>/dev/null)" --recursive --quiet 2>/dev/null
	terraform destroy -auto-approve
	rm -f $(STATE)

forget: ## Floci was restarted and lost everything: drop the stale state
	rm -f terraform.tfstate terraform.tfstate.backup $(STATE)
