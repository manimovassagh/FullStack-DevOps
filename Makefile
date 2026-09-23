# Local development shortcuts. Everything here targets Docker Compose + Floci on localhost.

export AWS_ACCESS_KEY_ID      ?= test
export AWS_SECRET_ACCESS_KEY  ?= test
export AWS_REGION             ?= us-east-1
export AWS_ENDPOINT_URL       ?= http://localhost:4566
export S3_BUCKET              ?= plant-media
export DATABASE_URL           ?= postgres://plant:plant@localhost:5432/plant?sslmode=disable
export TEST_DATABASE_URL      ?= postgres://plant:plant@localhost:5432/plant_test?sslmode=disable

AWS := aws --endpoint-url $(AWS_ENDPOINT_URL)

.PHONY: up down reset bucket backend frontend test test-backend test-frontend

up: ## start postgres + floci and create the bucket
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
	cd backend && go run ./cmd/server

frontend: ## run the Vite dev server on :5173
	cd frontend && npm run dev

test: test-backend test-frontend

test-backend:
	cd backend && go test ./...

test-frontend:
	cd frontend && npm test
