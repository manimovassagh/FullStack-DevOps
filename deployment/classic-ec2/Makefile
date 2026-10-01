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

.PHONY: ami artifacts init plan apply smoke health ssh-backend ssh-frontend destroy forget

ami: ## bake the systemd Ubuntu image Floci uses for ami-ubuntu2404-cloud (see FLOCI-NOTES.md)
	docker build -t floci/ami-ubuntu:24.04-$(GOARCH) ami

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

smoke:
	./scripts/smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)"

health: ## target health of both target groups
	@for tg in backend frontend; do echo "$$tg:"; $(AWS) elbv2 describe-target-health \
		--target-group-arn "$$(terraform output -raw $${tg}_target_group_arn)" \
		--query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output text; done

ssh-backend:
	./scripts/ssh.sh "$$(terraform output -raw backend_instance_id)"

ssh-frontend:
	./scripts/ssh.sh "$$(terraform output -raw frontend_instance_id)"

destroy:
	terraform destroy -auto-approve

forget: ## Floci was restarted and lost everything: drop the stale state so the next apply starts clean
	rm -f terraform.tfstate terraform.tfstate.backup
