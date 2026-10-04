# Observability dashboard. Usage: `make up`, then open http://localhost:3400
COMPOSE := docker compose -f compose.yaml

.PHONY: up open status logs down reset

up: ## build the exporter and start Prometheus + Grafana
	$(COMPOSE) up -d --build --wait grafana
	@echo "Dashboard: http://localhost:3400   (Prometheus: http://localhost:9091)"

open: ## open the dashboard in the browser
	open http://localhost:3400

status: ## which sources the exporter can reach right now
	@curl -s localhost:9091/api/v1/query --data-urlencode 'query=observability_source_up' | jq -r '.data.result[] | "\(.metric.source)\t\(.value[1])"'

logs: ## exporter output
	$(COMPOSE) logs -f exporter

down: ## stop everything, keep the data
	$(COMPOSE) down

reset: ## stop everything and delete the stored metrics and Grafana state
	$(COMPOSE) down -v
