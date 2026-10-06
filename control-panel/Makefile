# Control panel: run and watch the local deployments. Usage: `make run`, then open http://localhost:3500
.PHONY: run build dev open

run: ui/dist/index.html ## build the UI if needed, then start the panel (Ctrl-C to stop)
	python3 server.py

build ui/dist/index.html: ui/package.json $(shell find ui/src -type f 2>/dev/null) ## build the single-page app
	cd ui && npm ci --silent && npm run build

dev: ## UI development with hot reload on :5174 (keep `make run` going for the API)
	cd ui && npm run dev

open:
	open http://localhost:3500
