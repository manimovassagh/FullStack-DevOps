# Local HTTPS for the lab: mkcert certificate + Caddy on :443. Usage: `make up`, then open the URLs below.
SHELL := /bin/bash
NAMES := mission-control.lab.localhost ci.lab.localhost grafana.lab.localhost prometheus.lab.localhost '*.lab.localhost'
URLS  := https://mission-control.lab.localhost https://ci.lab.localhost https://grafana.lab.localhost https://prometheus.lab.localhost

.PHONY: trust certs up down status

trust: ## once per Mac: let macOS and the browsers trust mkcert's local CA (asks for your password)
	mkcert -install

certs: ## the certificate for every *.lab.localhost name, signed by the local CA (git-ignored)
	@command -v mkcert >/dev/null || { echo "install mkcert first: brew install mkcert"; exit 1; }
	@mkdir -p certs
	mkcert -cert-file certs/lab.pem -key-file certs/lab-key.pem $(NAMES)

up: ## start the HTTPS front door (creates the certificate on first use)
	@[ -f certs/lab.pem ] || $(MAKE) -s certs
	docker compose up -d
	@echo; for u in $(URLS); do echo "  $$u"; done; echo

down: ## stop it (everything stays reachable on its http://localhost port)
	docker compose down

status: ## which names answer through the proxy
	@for u in $(URLS); do printf '%-42s %s\n' "$$u" "$$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --cacert "$$(mkcert -CAROOT)/rootCA.pem" $$u/)"; done
