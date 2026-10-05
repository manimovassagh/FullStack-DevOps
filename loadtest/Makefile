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

.PHONY: smoke load spike stress check

smoke load spike stress: check
	docker run --rm -i --network plant-observability_default --add-host host.docker.internal:host-gateway \
		-v "$(CURDIR)":/scripts:ro \
		-e BASE_URL=http://host.docker.internal:$(PORT) -e AUTH=$(AUTH) -e PROFILE=$@ -e STAGE=$(STAGE) \
		-e K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write \
		-e K6_PROMETHEUS_RW_TREND_STATS="p(50),p(95),p(99),avg,max" \
		-e K6_PROMETHEUS_RW_PUSH_INTERVAL=5s \
		$(K6) run -o experimental-prometheus-rw --tag testid=$(STAGE)-$@-$$(date +%H%M%S) /scripts/plant-journey.js

check: ## the stage must answer and the observability stack must be running
	@[ -n "$(PORT)" ] || { echo "unknown STAGE=$(STAGE)"; exit 1; }
	@curl -sf -o /dev/null http://localhost:$(PORT)/ || { echo "$(STAGE) is not up on :$(PORT) (start it in the control panel)"; exit 1; }
	@docker network inspect plant-observability_default >/dev/null 2>&1 || { echo "start observability first: make -C observability up"; exit 1; }
