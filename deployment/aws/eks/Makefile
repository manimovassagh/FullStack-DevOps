# EKS deployment on Floci. Run from this directory.
# Terraform builds the platform (VPC, cluster, ECR, RDS, S3, ALB);
# kubectl + kustomize ship the app into the cluster.
SHELL := /bin/bash
ROOT  := $(abspath ../../..)
SMOKE := ../../smoke
BUILD := build

export AWS_ACCESS_KEY_ID     ?= test
export AWS_SECRET_ACCESS_KEY ?= test
export AWS_REGION            ?= us-east-1
FLOCI := http://localhost:4566
AWS   := aws --endpoint-url $(FLOCI)
export KUBECONFIG := $(CURDIR)/$(BUILD)/kubeconfig

# Image tag = git commit (+ -dirty for uncommitted changes); override with IMAGE_TAG=...
IMAGE_TAG := $(or $(IMAGE_TAG),$(shell git rev-parse --short HEAD)$(shell git diff --quiet HEAD -- $(ROOT)/backend $(ROOT)/frontend || echo -dirty))
# the compose network Floci and the k3s node share
FLOCI_NETWORK ?= fullstack-devops_default
REGISTRY  := 000000000000.dkr.ecr.$(AWS_REGION).localhost:4566
K         := kubectl -n plant

WAIT_TRIES ?= 72 # × 5 s

.PHONY: init repos images push deploy kubeconfig secrets app register up rollout plan check smoke health wait logs destroy forget

init:
	terraform init

repos: ## create the ECR repositories first, so images can be pushed before the cluster needs them
	terraform apply -auto-approve -target=aws_ecr_repository.app

images: ## build both images locally as plant/<svc>:$(IMAGE_TAG) (CI builds them in a separate job)
	for svc in backend frontend; do docker build -t plant/$$svc:$(IMAGE_TAG) $(ROOT)/$$svc || exit 1; done

push: repos ## tag the local images for ECR and push them
	$(AWS) ecr get-login-password | docker login --username AWS --password-stdin $(REGISTRY) >/dev/null
	for svc in backend frontend; do \
		docker tag plant/$$svc:$(IMAGE_TAG) $(REGISTRY)/plant-eks-$$svc:$(IMAGE_TAG) && \
		docker push -q $(REGISTRY)/plant-eks-$$svc:$(IMAGE_TAG) || exit 1; \
	done

deploy: ## terraform apply: the platform (no app yet)
	terraform apply -auto-approve -input=false

kubeconfig: ## write build/kubeconfig; auth is `aws eks get-token`, exactly as on real EKS
	@mkdir -p $(BUILD)
	$(AWS) eks update-kubeconfig --name "$$(terraform output -raw cluster)" --kubeconfig $(KUBECONFIG) >/dev/null
	@# sign tokens as the kubectl IAM user (Floci rejects the shared test/test key for EKS)
	@terraform output -json kubectl_access_key | python3 scripts/kubeconfig-credentials.py $(KUBECONFIG)
	@chmod 600 $(KUBECONFIG)
	@for i in $$(seq 1 60); do kubectl get --raw /readyz >/dev/null 2>&1 && break; sleep 2; done
	kubectl get nodes -o wide

secrets: ## DATABASE_URL from Secrets Manager into a Kubernetes Secret (+ Floci-only AWS endpoint)
	kubectl apply -f k8s/namespace.yaml >/dev/null
	$(K) create secret generic database --dry-run=client -o yaml \
		--from-literal=DATABASE_URL="$$($(AWS) secretsmanager get-secret-value --secret-id "$$(terraform output -raw database_secret_arn)" --query SecretString --output text)" \
		| kubectl apply -f -
	@# Floci's own address as seen from inside the cluster = the RDS proxy host (see FLOCI-NOTES.md)
	$(K) create secret generic aws-local --dry-run=client -o yaml \
		--from-literal=AWS_ENDPOINT_URL="http://$$($(AWS) rds describe-db-instances --db-instance-identifier plant-eks --query 'DBInstances[0].Endpoint.Address' --output text):4566" \
		--from-literal=AWS_ACCESS_KEY_ID=test --from-literal=AWS_SECRET_ACCESS_KEY=test \
		| kubectl apply -f -

app: ## render the overlay (images, IRSA role, config) and roll it out
	@mkdir -p $(BUILD)/overlay
	@printf '%s\n' \
		'apiVersion: kustomize.config.k8s.io/v1beta1' \
		'kind: Kustomization' \
		'resources: [../../k8s]' \
		'images:' \
		'  - { name: backend, newName: $(REGISTRY)/plant-eks-backend, newTag: "$(IMAGE_TAG)" }' \
		'  - { name: frontend, newName: $(REGISTRY)/plant-eks-frontend, newTag: "$(IMAGE_TAG)" }' \
		'configMapGenerator:' \
		'  - name: backend-config' \
		'    namespace: plant' \
		'    literals: [S3_BUCKET=$(shell terraform output -raw media_bucket), AWS_REGION=$(AWS_REGION)]' \
		'patches:' \
		'  - target: { kind: ServiceAccount, name: backend }' \
		'    patch: |-' \
		'      - { op: replace, path: /metadata/annotations/eks.amazonaws.com~1role-arn, value: "$(shell terraform output -raw backend_role_arn)" }' \
		> $(BUILD)/overlay/kustomization.yaml
	kubectl apply -k $(BUILD)/overlay
	$(K) rollout status deploy/backend --timeout=180s
	$(K) rollout status deploy/frontend --timeout=180s

register: ## point the ALB target groups at the nodes' NodePorts
	FLOCI_NETWORK=$(FLOCI_NETWORK) scripts/register-nodes.sh

up: images push deploy kubeconfig secrets app register wait ## everything, from nothing to a working URL

rollout: ## deployment test: same images under a new tag; expect a new ReplicaSet, zero downtime, passing API smoke
	@before=$$($(K) get deploy backend -o jsonpath='{.status.observedGeneration}'); \
	for svc in backend frontend; do docker tag plant/$$svc:$(IMAGE_TAG) plant/$$svc:$(IMAGE_TAG)-rollout; done; \
	$(MAKE) -s push app IMAGE_TAG=$(IMAGE_TAG)-rollout >/dev/null || exit 1; \
	after=$$($(K) get deploy backend -o jsonpath='{.status.observedGeneration}'); \
	echo "backend generation: $$before → $$after"; \
	[ "$$before" != "$$after" ] || { echo "FAIL: deployment did not roll"; exit 1; }; \
	$(K) get pods -l app=backend -o jsonpath='{range .items[*]}{.spec.containers[0].image}{"\n"}{end}' | grep -q -- '-rollout$$' || { echo "FAIL: pods not on the new image"; exit 1; }; \
	$(MAKE) -s wait >/dev/null && $(SMOKE)/api-smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)" | tail -1

plan:
	terraform plan

check: ## idempotency: after an apply, a plan must show no changes (exit 0)
	terraform plan -detailed-exitcode -input=false

smoke: ## API + browser smoke tests through the ALB (shared with every deployment style)
	$(SMOKE)/api-smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)"
	cd $(SMOKE) && npm ci --silent && npx playwright install chromium >/dev/null \
		&& SMOKE_BASE_URL="$$(cd $(CURDIR) && terraform output -raw app_url)" npx playwright test

health: ## pods + target health of both target groups
	@$(K) get pods -o wide 2>/dev/null || true
	@for tg in backend frontend; do echo "$$tg:"; $(AWS) elbv2 describe-target-health \
		--target-group-arn "$$(terraform output -json target_group_arns | python3 -c "import sys,json;print(json.load(sys.stdin)['$$tg'])")" \
		--query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State,TargetHealth.Reason]' --output text; done

wait: ## block until both target groups have only healthy targets
	@for i in $$(seq 1 $(WAIT_TRIES)); do \
		out=$$($(MAKE) -s health 2>/dev/null | sed -n '/^backend:/,$$p'); \
		[ "$$(echo "$$out" | grep -c healthy)" -ge 2 ] && [ -z "$$(echo "$$out" | grep -E 'unhealthy|initial|draining')" ] && { echo "$$out"; exit 0; }; \
		sleep 5; \
	done; echo "targets not healthy:"; $(MAKE) -s health; exit 1

logs: ## recent output of every pod
	@$(K) logs -l 'app in (backend,frontend)' --tail 20 --prefix 2>/dev/null || true

destroy: ## empty the bucket first: on Floci, the provider's force_destroy can loop forever on leftover objects
	-@$(AWS) s3 rm "s3://$$(terraform output -raw media_bucket 2>/dev/null)" --recursive --quiet 2>/dev/null
	terraform destroy -auto-approve
	rm -rf $(BUILD)

forget: ## Floci was restarted and lost everything: drop the stale state
	rm -f terraform.tfstate terraform.tfstate.backup
	rm -rf $(BUILD)
