# backend-serverless

The Plant Parent API as an AWS Lambda function. It is a standalone Go project (its own `go.mod`) with the same routes as [`../backend`](../backend), so the two can be deployed and changed independently. It is deployed by [`../deployment/serverless`](../deployment/serverless).

- `cmd/lambda`: the entry point. `main.go` builds the router once per cold start; `adapter.go` converts API Gateway (HTTP API, payload 2.0) events to `http.Request`s and back; `secret.go` reads the database URL from Secrets Manager.
- `internal/`: handlers, storage and store, copied from `backend` on purpose (no shared code between deployment styles).

```bash
go test ./...          # unit tests; integration tests need TEST_DATABASE_URL + Floci (see the backend README)
```
