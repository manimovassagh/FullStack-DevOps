# MCP servers for the lab: lab-learn (read-only knowledge) and lab-operate (guarded control). Run from this directory.
SHELL := /bin/bash
PY    := .venv/bin/python
ROOT  := $(abspath ..)

.PHONY: install test eval catalog check run-learn run-operate config clean

install: ## create .venv and install the package with its test dependencies
	python3 -m venv .venv
	$(PY) -m pip install -q --upgrade pip
	$(PY) -m pip install -q -e '.[dev]'

test: ## unit tests: safety, catalog, search, both servers over the protocol and over stdio
	$(PY) -m pytest -q

eval: ## score lab-learn on eval/questions.yaml against the real repository (fails below 90 %)
	$(PY) eval/run.py --root $(ROOT) -v

catalog: ## a table of every stage as the catalog sees it (add --json for the full catalog)
	$(PY) -m lab_mcp.learn.catalog --root $(ROOT)

check: ## the docs and the generator agree (errors fail; missing README tables are warnings)
	$(PY) -m lab_mcp.learn.catalog --root $(ROOT) --check

run-learn: ## start lab-learn on stdio (a client normally starts it; this is for poking at it)
	LAB_ROOT=$(ROOT) $(PY) -m lab_mcp.learn.server

run-operate: ## start lab-operate on stdio (needs Mission Control: make dashboard-up)
	LAB_ROOT=$(ROOT) $(PY) -m lab_mcp.operate.server

config: ## print the client configuration (Claude Code / Claude Desktop / Cursor) with this machine's paths
	@printf '{\n  "mcpServers": {\n    "lab-learn":   { "command": "%s/.venv/bin/lab-learn" },\n    "lab-operate": { "command": "%s/.venv/bin/lab-operate", "env": { "LAB_PANEL_URL": "http://localhost:3500" } }\n  }\n}\n' "$(CURDIR)" "$(CURDIR)"

clean:
	rm -rf .venv .pytest_cache src/*.egg-info
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
