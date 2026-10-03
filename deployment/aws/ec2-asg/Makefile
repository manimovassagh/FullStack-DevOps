# EC2 Auto Scaling Group deployment on Floci. Run from this directory.
SHELL := /bin/bash
ROOT  := $(abspath ../../..)
BUILD := build

export AWS_ACCESS_KEY_ID     ?= test
export AWS_SECRET_ACCESS_KEY ?= test
export AWS_REGION            ?= us-east-1
FLOCI := http://localhost:4566
AWS   := aws --endpoint-url $(FLOCI)

# The AMI (ami-ubuntu2404-cloud) is arm64, so instances are arm64 containers:
# native on Apple Silicon, emulated with QEMU on amd64 hosts such as CI runners.
GOARCH := arm64

.PHONY: ami artifacts init plan apply deploy check smoke health wait instances roll rollout ssh-backend ssh-frontend destroy forget

ami: ## bake the Ubuntu 24.04 + systemd image Floci uses for ami-ubuntu2404-cloud (see FLOCI-NOTES.md)
	docker build --platform linux/arm64 -t floci/ami-ubuntu:24.04-arm64 ami

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

apply: artifacts deploy

# A new release label creates a new launch-template version (see variables.tf); `make roll` replaces the instances.
RELEASE ?= initial
export TF_VAR_release := $(RELEASE)

deploy: ami ## terraform apply with the artifacts already in build/ (CI downloads them from the build job)
	terraform apply -auto-approve -input=false

check: ## idempotency: after an apply, a plan must show no changes (exit 0)
	terraform plan -detailed-exitcode -input=false

SMOKE := ../../smoke

smoke: ## API + browser smoke tests through the ALB (shared with every deployment style)
	$(SMOKE)/api-smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)"
	cd $(SMOKE) && npm ci --silent && npx playwright install chromium >/dev/null \
		&& SMOKE_STAGE=ec2-asg SMOKE_BASE_URL="$$(cd $(CURDIR) && terraform output -raw app_url)" npx playwright test

health: ## target health of both target groups
	@for tg in backend frontend; do echo "$$tg:"; $(AWS) elbv2 describe-target-health \
		--target-group-arn "$$(terraform output -raw $${tg}_target_group_arn)" \
		--query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output text; done

WAIT_TRIES ?= 72 # × 5 s; CI raises it because instances run under QEMU there

wait: ## block until both target groups are healthy (UserData takes a minute or two)
	@for i in $$(seq 1 $(WAIT_TRIES)); do \
		out=$$($(MAKE) -s health); \
		[ "$$(echo "$$out" | grep -c healthy)" = 2 ] && [ -z "$$(echo "$$out" | grep unhealthy)" ] && { echo "$$out"; exit 0; }; \
		sleep 5; \
	done; echo "targets not healthy:"; $(MAKE) -s health; exit 1

instances: ## the instances each Auto Scaling Group runs
	@for tier in backend frontend; do echo "$$tier:"; \
		$(AWS) autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$$(terraform output -json asg_names | jq -r .$$tier)" \
		--query 'AutoScalingGroups[0].[DesiredCapacity, Instances[].[InstanceId,LifecycleState,HealthStatus]]' --output json | jq -c .; done

roll: ## replace every instance with a new one from the latest launch-template version, one at a time, keeping capacity (what instance refresh automates)
	scripts/roll.sh

rollout: ## release test: new launch-template version (instances unchanged) → roll (instances replaced) → kill an instance (the group heals), API smoke after each
	scripts/rollout-test.sh

ssh-backend: ## ssh into the first backend instance
	./scripts/ssh.sh "$$($(AWS) autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$$(terraform output -json asg_names | jq -r .backend)" --query 'AutoScalingGroups[0].Instances[0].InstanceId' --output text)"

ssh-frontend: ## ssh into the first frontend instance
	./scripts/ssh.sh "$$($(AWS) autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$$(terraform output -json asg_names | jq -r .frontend)" --query 'AutoScalingGroups[0].Instances[0].InstanceId' --output text)"

destroy: ## empty the buckets first: on Floci, the provider's force_destroy can loop forever on leftover objects
	-@for b in $$(terraform output -raw media_bucket 2>/dev/null) plant-asg-artifacts; do $(AWS) s3 rm "s3://$$b" --recursive --quiet 2>/dev/null; done
	terraform destroy -auto-approve

forget: ## Floci was restarted and lost everything: drop the stale state so the next apply starts clean
	rm -f terraform.tfstate terraform.tfstate.backup
