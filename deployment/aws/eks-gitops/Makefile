# EKS + GitOps (Argo CD) deployment on Floci. Run from this directory.
# Terraform builds the platform (VPC, cluster, ECR, RDS, S3, ALB). Argo CD, running in the cluster, pulls the
# app (a Helm chart + a values file) from a git repo and keeps the cluster equal to it: a release is a commit.
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
ARGO_VERSION := v3.5.3
# The "git remote": a bare repo on disk, served read-only over HTTP by an nginx container on the compose network.
GITSRV    := plant-gitops-git
GITDIR    := $(BUILD)/git
WORK      := $(BUILD)/work
GIT       := git -C $(WORK) -c user.name=gitops -c user.email=gitops@local

WAIT_TRIES ?= 72 # × 5 s

.PHONY: init repos images push deploy kubeconfig secrets gitserver gitrepo argocd app release revert refresh status register up rollout plan check smoke health wait logs destroy forget

init:
	terraform init

repos: ## create the ECR repositories first, so images can be pushed before the cluster needs them
	terraform apply -auto-approve -target=aws_ecr_repository.app

images: ## build both images locally as plant/<svc>:$(IMAGE_TAG) (CI builds them in a separate job)
	for svc in backend frontend; do docker build -t plant/$$svc:$(IMAGE_TAG) $(ROOT)/$$svc || exit 1; done

push: repos ## tag the local images for ECR and push them
	$(AWS) ecr get-login-password | docker login --username AWS --password-stdin $(REGISTRY) >/dev/null
	for svc in backend frontend; do \
		docker tag plant/$$svc:$(IMAGE_TAG) $(REGISTRY)/plant-eks-gitops-$$svc:$(IMAGE_TAG) && \
		docker push -q $(REGISTRY)/plant-eks-gitops-$$svc:$(IMAGE_TAG) || exit 1; \
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
	kubectl create namespace plant --dry-run=client -o yaml | kubectl apply -f - >/dev/null
	$(K) create secret generic database --dry-run=client -o yaml \
		--from-literal=DATABASE_URL="$$($(AWS) secretsmanager get-secret-value --secret-id "$$(terraform output -raw database_secret_arn)" --query SecretString --output text)" \
		| kubectl apply -f -
	@# Floci's own address as seen from inside the cluster = the RDS proxy host (see FLOCI-NOTES.md)
	$(K) create secret generic aws-local --dry-run=client -o yaml \
		--from-literal=AWS_ENDPOINT_URL="http://$$($(AWS) rds describe-db-instances --db-instance-identifier plant-eks-gitops --query 'DBInstances[0].Endpoint.Address' --output text):4566" \
		--from-literal=AWS_ACCESS_KEY_ID=test --from-literal=AWS_SECRET_ACCESS_KEY=test \
		| kubectl apply -f -

gitserver: ## start the git remote: a bare repo (build/git/plant.git) served over HTTP on the compose network
	@mkdir -p $(GITDIR)
	@[ -d $(GITDIR)/plant.git ] || { git init -q --bare -b main $(GITDIR)/plant.git \
		&& cp $(GITDIR)/plant.git/hooks/post-update.sample $(GITDIR)/plant.git/hooks/post-update; }
	@docker rm -f $(GITSRV) >/dev/null 2>&1 || true
	docker run -d --name $(GITSRV) --network $(FLOCI_NETWORK) -v "$(CURDIR)/$(GITDIR):/usr/share/nginx/html:ro" nginx:alpine >/dev/null

gitrepo: ## first commit: the chart plus env/values.yaml (image tags, bucket, role ARN from Terraform outputs)
	rm -rf $(WORK) && git clone -q $(GITDIR)/plant.git $(WORK) 2>/dev/null
	mkdir -p $(WORK)/env && cp -R helm/plant $(WORK)/chart
	@printf '%s\n' \
		'# What runs in the cluster. Argo CD applies this with the chart; edit and push to release.' \
		'image:' \
		'  registry: $(REGISTRY)' \
		'  backend: { tag: "$(IMAGE_TAG)" }' \
		'  frontend: { tag: "$(IMAGE_TAG)" }' \
		'backend:' \
		'  s3Bucket: $(shell terraform output -raw media_bucket)' \
		'  awsRegion: $(AWS_REGION)' \
		'  roleArn: $(shell terraform output -raw backend_role_arn)' \
		> $(WORK)/env/values.yaml
	$(GIT) add -A && $(GIT) commit -q -m "plant $(IMAGE_TAG): initial chart and values" && $(GIT) push -q origin HEAD:main

argocd: ## install Argo CD (core: no UI, no SSO) and make it poll git every 20 s
	kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f - >/dev/null
	kubectl apply -n argocd --server-side --force-conflicts -f https://raw.githubusercontent.com/argoproj/argo-cd/$(ARGO_VERSION)/manifests/core-install.yaml >/dev/null
	kubectl -n argocd patch configmap argocd-cm --type merge -p '{"data":{"timeout.reconciliation":"20s"}}'
	kubectl -n argocd rollout restart statefulset/argocd-application-controller >/dev/null
	kubectl -n argocd rollout status statefulset/argocd-application-controller --timeout=300s
	kubectl -n argocd rollout status deploy/argocd-repo-server --timeout=300s
	kubectl -n argocd rollout status deploy/argocd-redis --timeout=300s

app: ## tell Argo CD to watch the repo (an Application with automated sync, prune and self-heal), then wait until it is Synced and Healthy
	@printf '%s\n' \
		'apiVersion: argoproj.io/v1alpha1' \
		'kind: Application' \
		'metadata: { name: plant, namespace: argocd }' \
		'spec:' \
		'  project: default' \
		'  source:' \
		'    repoURL: http://$(shell docker inspect -f '{{(index .NetworkSettings.Networks "$(FLOCI_NETWORK)").IPAddress}}' $(GITSRV))/plant.git' \
		'    targetRevision: main' \
		'    path: chart' \
		'    helm: { valueFiles: [../env/values.yaml] }' \
		'  destination: { server: "https://kubernetes.default.svc", namespace: plant }' \
		'  syncPolicy:' \
		'    automated: { prune: true, selfHeal: true }' \
		'    syncOptions: [CreateNamespace=true]' \
		> $(BUILD)/application.yaml
	kubectl apply -f $(BUILD)/application.yaml
	scripts/wait-synced.sh

release: ## TAG=<tag>  push the images and commit the new tag to git; Argo CD deploys it
	@[ -n "$(TAG)" ] || { echo "usage: make release TAG=<image tag>"; exit 1; }
	$(MAKE) -s push IMAGE_TAG=$(TAG)
	$(GIT) pull -q origin main
	sed -i.bak -E 's/(tag: )"[^"]*"/\1"$(TAG)"/' $(WORK)/env/values.yaml && rm -f $(WORK)/env/values.yaml.bak
	$(GIT) commit -q -am "release $(TAG)" && $(GIT) push -q origin HEAD:main
	$(MAKE) -s refresh
	scripts/wait-synced.sh

revert: ## roll back by reverting the last commit in git
	$(GIT) pull -q origin main
	$(GIT) revert --no-edit HEAD >/dev/null && $(GIT) push -q origin HEAD:main
	$(MAKE) -s refresh
	scripts/wait-synced.sh

refresh: ## ask Argo CD to re-read git now (otherwise it polls every 20 s)
	@kubectl -n argocd annotate application plant argocd.argoproj.io/refresh=hard --overwrite >/dev/null

status: ## Argo CD's view: sync status, health, the git revision it deployed
	@kubectl -n argocd get application plant -o jsonpath='{.status.sync.status} {.status.health.status} revision={.status.sync.revision}{"\n"}'; $(GIT) log --oneline -5

register: ## point the ALB target groups at the nodes' NodePorts
	FLOCI_NETWORK=$(FLOCI_NETWORK) scripts/register-nodes.sh

up: images push deploy kubeconfig secrets gitserver gitrepo argocd app register wait ## everything, from nothing to a working URL

rollout: ## release test: release a tag via git, revert it, then change the cluster by hand and watch Argo CD undo it
	IMAGE_TAG=$(IMAGE_TAG) scripts/rollout-test.sh

plan:
	terraform plan

check: ## idempotency: after an apply, a plan must show no changes (exit 0)
	terraform plan -detailed-exitcode -input=false

smoke: ## API + browser smoke tests through the ALB (shared with every deployment style)
	$(SMOKE)/api-smoke.sh "$$(terraform output -raw app_url)" "$$(terraform output -raw media_bucket)"
	cd $(SMOKE) && npm ci --silent && npx playwright install chromium >/dev/null \
		&& SMOKE_STAGE=eks-gitops SMOKE_BASE_URL="$$(cd $(CURDIR) && terraform output -raw app_url)" npx playwright test

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
	-@docker rm -f $(GITSRV) >/dev/null 2>&1
	-@$(AWS) s3 rm "s3://$$(terraform output -raw media_bucket 2>/dev/null)" --recursive --quiet 2>/dev/null
	terraform destroy -auto-approve
	rm -rf $(BUILD)

forget: ## Floci was restarted and lost everything: drop the stale state
	-@docker rm -f $(GITSRV) >/dev/null 2>&1
	rm -f terraform.tfstate terraform.tfstate.backup
	rm -rf $(BUILD)
