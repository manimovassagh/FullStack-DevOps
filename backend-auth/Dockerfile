# Plant Parent API image: static Go binary on distroless (no shell, runs as nonroot).
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# The repo-root go.work is not in this build context; build the module on its own.
RUN GOWORK=off CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/plant-api ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/plant-api /plant-api
EXPOSE 8080
ENTRYPOINT ["/plant-api"]
