# Local CI: Gitea + an Actions runner. Usage: `make up`, then `make push`, open http://localhost:3300
SHELL := /bin/bash
COMPOSE := docker compose -f compose.yaml
ADMIN_USER ?= ci
ADMIN_PASS ?= ci-password-1
REPO       ?= FullStack-DevOps
URL        := http://localhost:3300
ROOT       := $(abspath ..)

.PHONY: up admin runner push status logs down reset

up: ## start Gitea, create the admin user, register the runner
	$(COMPOSE) up -d --wait gitea
	$(MAKE) -s admin
	$(MAKE) -s runner
	@echo; echo "Gitea: $(URL)  (user $(ADMIN_USER), password $(ADMIN_PASS))"; echo "Next: make push"

admin: ## the admin user (idempotent)
	@$(COMPOSE) exec -T -u git gitea gitea admin user create --admin --username $(ADMIN_USER) --password $(ADMIN_PASS) \
		--email $(ADMIN_USER)@local.test --must-change-password=false 2>&1 | grep -v "already exists" || true

runner: ## register the runner with a fresh token and start it
	@token=$$($(COMPOSE) exec -T -u git gitea gitea actions generate-runner-token | tr -d '\r\n'); \
	RUNNER_TOKEN=$$token $(COMPOSE) --profile runner up -d runner

push: ## create the repo in Gitea (once) and push the current branch of this repo to it
	@curl -s -o /dev/null -w 'create repo: HTTP %{http_code} (201 created, 409 exists)\n' -u $(ADMIN_USER):$(ADMIN_PASS) \
		-X POST $(URL)/api/v1/user/repos -H 'content-type: application/json' -d '{"name":"$(REPO)","private":false}'
	@cd $(ROOT) && git push -f http://$(ADMIN_USER):$(ADMIN_PASS)@localhost:3300/$(ADMIN_USER)/$(REPO).git HEAD:refs/heads/$${BRANCH:-main}
	@echo "Pipelines: $(URL)/$(ADMIN_USER)/$(REPO)/actions"

status: ## runner state and recent runs
	@$(COMPOSE) ps
	@curl -s -u $(ADMIN_USER):$(ADMIN_PASS) "$(URL)/api/v1/repos/$(ADMIN_USER)/$(REPO)/actions/runs?limit=15" \
		| jq -r '.workflow_runs[] | "\(.id)\t\(.status)\t\(.conclusion // "-")\t\(.name // .display_title)"'

logs: ## runner output
	$(COMPOSE) logs -f runner

down: ## stop everything, keep the data
	$(COMPOSE) --profile runner down

reset: ## stop everything and delete Gitea's data (repos, runs, users)
	$(COMPOSE) --profile runner down -v
