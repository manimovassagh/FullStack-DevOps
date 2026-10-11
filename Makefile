# The repo's front door. `make` alone starts the cloud lab (Mission Control + observability) and opens it.
#   Cloud lab (most of the time): make dashboard-up, make deploy STAGE=ecs, make stages …
#   App development (changing the Go/React code): make up, make backend, make frontend, make test
# CI uses `make up` too (Postgres + Floci for the backend's integration tests).
.DEFAULT_GOAL := dashboard-up # `make` alone brings up the lab and opens it; `make help` lists everything

export AWS_ACCESS_KEY_ID      ?= test
export AWS_SECRET_ACCESS_KEY  ?= test
export AWS_REGION             ?= us-east-1
export AWS_ENDPOINT_URL       ?= http://localhost:4566
export S3_BUCKET              ?= plant-media
export DATABASE_URL           ?= postgres://plant:plant@localhost:5432/plant?sslmode=disable
export TEST_DATABASE_URL      ?= postgres://plant:plant@localhost:5432/plant_test?sslmode=disable

AWS := aws --endpoint-url $(AWS_ENDPOINT_URL)

.PHONY: help up down reset bucket backend frontend test test-backend test-frontend \
	dashboard-up dashboard-down dashboard-status dashboard-logs ci-up ci-down stages deploy destroy smoke release forget loadtest docker

help: ## list the targets
	@echo "Cloud lab"; grep -hE '^(dashboard|stages|deploy|destroy|smoke|release|forget|loadtest|docker|ci)[a-z-]*:.*## ' $(MAKEFILE_LIST) | sed 's/:.*## /\t/' | awk -F'\t' '{printf "  make %-18s %s\n", $$1, $$2}'
	@echo; echo "App development"; grep -hE '^(up|down|reset|bucket|backend|frontend|test)[a-z-]*:.*## ' $(MAKEFILE_LIST) | sed 's/:.*## /\t/' | awk -F'\t' '{printf "  make %-18s %s\n", $$1, $$2}'

up: ## start postgres + floci and create the bucket (also used by CI)
	docker compose up -d --wait
	@$(MAKE) --no-print-directory bucket

down: ## stop containers (keeps the postgres volume)
	docker compose down

reset: ## stop containers and wipe the postgres volume
	docker compose down -v

bucket: ## create the S3 bucket in Floci if it does not exist
	@$(AWS) s3api head-bucket --bucket $(S3_BUCKET) >/dev/null 2>&1 \
		|| $(AWS) s3 mb s3://$(S3_BUCKET)

backend: ## run the Go API on :8080
	cd apps/backend && go run ./cmd/server

frontend: ## run the Vite dev server on :5173
	cd apps/frontend && npm run dev

test: test-backend test-frontend ## unit tests of backend and frontend

test-backend:
	cd apps/backend && go test ./...

test-frontend:
	cd apps/frontend && npm test

# ── The cloud lab: Mission Control + observability, and every deployment from the terminal ─────────
# `make dashboard-up` starts Prometheus + Grafana and Mission Control in the background.
# `make deploy STAGE=ecs` (destroy, smoke, release, forget, loadtest) runs through the panel: the log streams
# here and the run shows up live in the panel, with the same safety rules as its buttons.
PANEL_URL := http://localhost:3500
PANEL_PID := platform/mission-control/.panel.pid
PANEL_LOG := platform/mission-control/.panel.log
LAB       := python3 platform/mission-control/cli.py

docker: ## make sure Docker answers (starts OrbStack on macOS if needed)
	@docker info >/dev/null 2>&1 || { \
		echo "Docker is not running; starting OrbStack…"; \
		if command -v orb >/dev/null; then orb start >/dev/null 2>&1; else open -a OrbStack 2>/dev/null; fi; \
		for i in $$(seq 1 72); do docker info >/dev/null 2>&1 && exit 0; sleep 5; done; \
		echo "Docker did not come up"; exit 1; }

dashboard-up: docker ## start observability + Mission Control in the background, then open it
	@$(MAKE) --no-print-directory -C platform/observability up
	@$(MAKE) --no-print-directory -C platform/mission-control ui/dist/index.html
	@if curl -sf -o /dev/null $(PANEL_URL)/api/status; then echo "Mission Control already running"; else \
		nohup python3 platform/mission-control/server.py > $(PANEL_LOG) 2>&1 & echo $$! > $(PANEL_PID); \
		for i in $$(seq 1 20); do curl -sf -o /dev/null $(PANEL_URL)/api/status && break; sleep 0.5; done; \
		echo "Mission Control started (pid $$(cat $(PANEL_PID)), log $(PANEL_LOG))"; fi
	@echo; echo "  Mission Control  $(PANEL_URL)"; echo "  Grafana        http://localhost:3400"; echo "  Prometheus     http://localhost:9091"
	@echo; echo "  From here: make deploy STAGE=ecs · make stages · make help"; echo
	@open $(PANEL_URL) 2>/dev/null || true

dashboard-down: ## stop Mission Control and observability (deployments keep running)
	@if [ -f $(PANEL_PID) ] && kill $$(cat $(PANEL_PID)) 2>/dev/null; then echo "Mission Control stopped"; else echo "Mission Control was not running"; fi
	@rm -f $(PANEL_PID)
	@$(MAKE) --no-print-directory -C platform/observability down

dashboard-status: ## what is up: panel, observability, every stage
	@curl -sf -o /dev/null $(PANEL_URL)/api/status && $(LAB) stages || echo "Mission Control is not running (make dashboard-up)"

dashboard-logs: ## follow Mission Control's own log
	tail -f $(PANEL_LOG)

ci-up: _panel ## start the local CI (Gitea + runner) through the panel
	@$(LAB) ci up

ci-down: _panel ## stop the local CI
	@$(LAB) ci down

_panel: # start the panel when it is not running (deploy & co. need it)
	@curl -sf -o /dev/null $(PANEL_URL)/api/status || $(MAKE) --no-print-directory dashboard-up

_stage:
	@[ -n "$(STAGE)" ] || { echo "say which one: make $(MAKECMDGOALS) STAGE=<stage>"; echo; $(LAB) stages; exit 1; }

stages: _panel ## list the deployments and their state
	@$(LAB) stages

deploy: _panel _stage ## deploy a stage:          make deploy STAGE=ecs
	@$(LAB) deploy $(STAGE)

destroy: _panel _stage ## tear a stage down:       make destroy STAGE=ecs
	@$(LAB) destroy $(STAGE)

smoke: _panel _stage ## API + browser smoke tests: make smoke STAGE=ecs
	@$(LAB) smoke $(STAGE)

release: _panel _stage ## roll out a new version:   make release STAGE=ecs
	@$(LAB) release $(STAGE)

forget: _panel _stage ## drop a stale state:        make forget STAGE=ecs
	@$(LAB) forget $(STAGE)

loadtest: _panel _stage ## k6 load test:            make loadtest STAGE=ecs PROFILE=load
	@$(LAB) loadtest $(STAGE) $(or $(PROFILE),load)
