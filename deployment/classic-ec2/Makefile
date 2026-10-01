# Classic EC2 deployment on Floci. Run from this directory.
SHELL := /bin/bash
ROOT  := $(abspath ../..)
BUILD := build

export AWS_ACCESS_KEY_ID     ?= test
export AWS_SECRET_ACCESS_KEY ?= test
export AWS_REGION            ?= us-east-1
FLOCI := http://localhost:4566
AWS   := aws --endpoint-url $(FLOCI)

# Instances are containers on the local Docker, so build for its CPU.
DOCKER_ARCH := $(shell docker info --format '{{.Architecture}}' 2>/dev/null)
GOARCH      := $(if $(filter aarch64 arm64,$(DOCKER_ARCH)),arm64,amd64)

.PHONY: ami artifacts init plan apply smoke health wait ssh-backend ssh-frontend destroy forget

ami: ## bake the systemd Ubuntu image Floci uses for ami-ubuntu2404-cloud (see FLOCI-NOTES.md)
	# Both tags: Floci's catalog maps the alias to the -arm64 tag even on amd64 hosts (CI runners).
	docker build -t floci/ami-ubuntu:24.04-arm64 -t floci/ami-ubuntu:24.04-amd64 ami

artifacts: ## build the Go binary and the React bundle that instances download from S3
	mkdir -p $(BUILD)
	cd $(ROOT)/backend && CGO_ENABLED=0 GOOS=linux GOARCH=$(GOARCH) \
		go build -trimpath -ldflags='-s -w' -o $(CURDIR)/$(BUILD)/plant-api ./cmd/server
	cd $(ROOT)/frontend && npm ci --silent && npm run build
	COPYFILE_DISABLE=1 tar -czf $(BUILD)/dist.tar.gz -C $(ROOT)/frontend/dist .

init:
	terraform init

plan: artifacts
	terraform plan

apply: ami artifacts
	terraform apply -auto-approve

SMOKE := ../smoke

smoke: ## API + browser smoke tests through the ALB (shared with every deployment style)
	$(SMOKE)/api-smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)"
	cd $(SMOKE) && npm ci --silent && npx playwright install chromium >/dev/null \
		&& SMOKE_BASE_URL="$$(cd $(CURDIR) && terraform output -raw app_url)" npx playwright test

health: ## target health of both target groups
	@for tg in backend frontend; do echo "$$tg:"; $(AWS) elbv2 describe-target-health \
		--target-group-arn "$$(terraform output -raw $${tg}_target_group_arn)" \
		--query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output text; done

wait: ## block until both target groups are healthy (UserData takes a minute or two), max ~6 min
	@for i in $$(seq 1 72); do \
		out=$$($(MAKE) -s health); \
		[ "$$(echo "$$out" | grep -c healthy)" = 2 ] && [ -z "$$(echo "$$out" | grep unhealthy)" ] && { echo "$$out"; exit 0; }; \
		sleep 5; \
	done; echo "targets not healthy:"; $(MAKE) -s health; exit 1

ssh-backend:
	./scripts/ssh.sh "$$(terraform output -raw backend_instance_id)"

ssh-frontend:
	./scripts/ssh.sh "$$(terraform output -raw frontend_instance_id)"

destroy:
	terraform destroy -auto-approve

forget: ## Floci was restarted and lost everything: drop the stale state so the next apply starts clean
	rm -f terraform.tfstate terraform.tfstate.backup
