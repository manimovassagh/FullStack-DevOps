# ECS (Fargate) deployment on Floci. Run from this directory.
SHELL := /bin/bash
ROOT  := $(abspath ../..)
SMOKE := ../smoke

export AWS_ACCESS_KEY_ID     ?= test
export AWS_SECRET_ACCESS_KEY ?= test
export AWS_REGION            ?= us-east-1
FLOCI := http://localhost:4566
AWS   := aws --endpoint-url $(FLOCI)

# Image tag = git commit (+ -dirty for uncommitted changes); override with IMAGE_TAG=...
IMAGE_TAG ?= $(shell git rev-parse --short HEAD)$(shell git diff --quiet HEAD -- $(ROOT)/backend $(ROOT)/frontend || echo -dirty)
export TF_VAR_image_tag := $(IMAGE_TAG)
REGISTRY := 000000000000.dkr.ecr.$(AWS_REGION).localhost:4566

WAIT_TRIES ?= 72 # × 5 s

.PHONY: init repos images apply plan check smoke health wait logs destroy forget

init:
	terraform init

repos: ## create the ECR repositories first, so images can be pushed before the services need them
	terraform apply -auto-approve -target=aws_ecr_repository.app

images: repos ## build both images and push them to ECR as :$(IMAGE_TAG)
	$(AWS) ecr get-login-password | docker login --username AWS --password-stdin $(REGISTRY) >/dev/null
	for svc in backend frontend; do \
		docker build -t $(REGISTRY)/plant-ecs-$$svc:$(IMAGE_TAG) $(ROOT)/$$svc && \
		docker push -q $(REGISTRY)/plant-ecs-$$svc:$(IMAGE_TAG) || exit 1; \
	done

apply: images
	terraform apply -auto-approve

plan:
	terraform plan

check: ## idempotency: after an apply, a plan must show no changes (exit 0)
	terraform plan -detailed-exitcode -input=false

smoke: ## API + browser smoke tests through the ALB (shared with every deployment style)
	$(SMOKE)/api-smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)"
	cd $(SMOKE) && npm ci --silent && npx playwright install chromium >/dev/null \
		&& SMOKE_BASE_URL="$$(cd $(CURDIR) && terraform output -raw app_url)" npx playwright test

health: ## target health of both target groups
	@for tg in backend frontend; do echo "$$tg:"; $(AWS) elbv2 describe-target-health \
		--target-group-arn "$$(terraform output -raw $${tg}_target_group_arn)" \
		--query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output text; done

wait: ## block until both target groups have only healthy targets
	@for i in $$(seq 1 $(WAIT_TRIES)); do \
		out=$$($(MAKE) -s health); \
		[ "$$(echo "$$out" | grep -c healthy)" -ge 2 ] && [ -z "$$(echo "$$out" | grep -E 'unhealthy|initial|draining')" ] && { echo "$$out"; exit 0; }; \
		sleep 5; \
	done; echo "targets not healthy:"; $(MAKE) -s health; exit 1

logs: ## show the running task containers' output (Floci keeps logs in Docker, not CloudWatch)
	@for c in $$(docker ps --format '{{.Names}}' | grep -i -E 'ecs.*(backend|frontend)'); do echo "== $$c"; docker logs --tail 20 $$c; done

destroy: ## empty the bucket first: on Floci, the provider's force_destroy can loop forever on leftover objects
	-@$(AWS) s3 rm "s3://$$(terraform output -raw media_bucket 2>/dev/null)" --recursive --quiet 2>/dev/null
	terraform destroy -auto-approve

forget: ## Floci was restarted and lost everything: drop the stale state
	rm -f terraform.tfstate terraform.tfstate.backup
