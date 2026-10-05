# Load tests with k6, metrics live in Grafana (observability/). Usage:
#   make -C loadtest load STAGE=ecs-cognito      profiles: smoke | load | spike | stress
#   open http://localhost:3400/d/load-test
SHELL   := /bin/bash
K6      := grafana/k6:2.3.0
STAGE   ?= ecs-cognito
# Where each stage listens on the host; k6 runs in Docker and reaches it via host.docker.internal.
PORT_classic-ec2    := 8088
PORT_ecs            := 8089
PORT_eks            := 8090
PORT_ecs-blue-green := 8091
PORT_ec2-asg        := 8093
PORT_eks-helm       := 8094
PORT_eks-gitops     := 8095
PORT_ecs-cognito    := 8096
PORT    := $(PORT_$(STAGE))
AUTH    := $(if $(filter ecs-cognito,$(STAGE)),true,false)

# breakpoint (up to MAX_VUS=1000 users) runs k6 natively when it is installed (brew install k6): a thousand
# virtual users need more memory than the Docker VM has left next to the app.
.PHONY: smoke load spike stress breakpoint check

breakpoint: check
	@if command -v k6 >/dev/null; then \
		BASE_URL=http://localhost:$(PORT) AUTH=$(AUTH) PROFILE=$@ STAGE=$(STAGE) MAX_VUS=$${MAX_VUS:-1000} \
		K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9091/api/v1/write K6_PROMETHEUS_RW_TREND_STATS="p(50),p(95),p(99),avg,max" \
		K6_PROMETHEUS_RW_PUSH_INTERVAL=5s \
		k6 run -o experimental-prometheus-rw --tag testid=$(STAGE)-$@-$$(date +%H%M%S) plant-journey.js; \
	else $(MAKE) -s _docker PROFILE=$@; fi

smoke load spike stress:
	@$(MAKE) -s _docker PROFILE=$@

_docker: check
	docker run --rm -i --network plant-observability_default --add-host host.docker.internal:host-gateway \
		-v "$(CURDIR)":/scripts:ro \
		-e BASE_URL=http://host.docker.internal:$(PORT) -e AUTH=$(AUTH) -e PROFILE=$(PROFILE) -e STAGE=$(STAGE) -e MAX_VUS=$${MAX_VUS:-1000} \
		-e K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write \
		-e K6_PROMETHEUS_RW_TREND_STATS="p(50),p(95),p(99),avg,max" \
		-e K6_PROMETHEUS_RW_PUSH_INTERVAL=5s \
		$(K6) run -o experimental-prometheus-rw --tag testid=$(STAGE)-$(PROFILE)-$$(date +%H%M%S) /scripts/plant-journey.js

check: ## the stage must answer and the observability stack must be running
	@[ -n "$(PORT)" ] || { echo "unknown STAGE=$(STAGE)"; exit 1; }
	@curl -sf -o /dev/null http://localhost:$(PORT)/ || { echo "$(STAGE) is not up on :$(PORT) (start it in the control panel)"; exit 1; }
	@docker network inspect plant-observability_default >/dev/null 2>&1 || { echo "start observability first: make -C observability up"; exit 1; }
