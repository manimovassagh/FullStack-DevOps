# Plant Parent — App (Stages 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Plant Parent app (React frontend + Go backend + Postgres + S3 on Floci) and run it end-to-end locally. Deployment to ECS/ALB/RDS is a separate plan.

**Architecture:** React SPA calls relative `/api/*` (Vite proxy → Go/Echo on :8080). Echo handlers depend on two interfaces, `Store` (Postgres via pgx) and `FileStorage` (S3 via aws-sdk-go-v2, pointed at Floci). Config comes only from env vars.

**Tech Stack:** Go 1.26, Echo v4, pgx/v5, aws-sdk-go-v2, google/uuid · Node 25, Vite, React, TypeScript, Tailwind CSS v4, shadcn/ui, react-router, lucide-react, sonner, Vitest + React Testing Library · Docker Compose (postgres:16-alpine, floci/floci).

**Spec:** `docs/superpowers/specs/2026-09-23-plant-parent-design.md`

## Global Constraints

- Build order is fixed by the user: **frontend → backend → run locally**.
- Go module path: `github.com/manimovassagh/FullStack-DevOps/backend`.
- Echo **v4** (`github.com/labstack/echo/v4`), not v5.
- Every API error body is `{"error": "<message>"}`.
- Frontend only ever calls relative `/api/...` URLs.
- Inline media types (backend & frontend must agree): `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
- `MAX_UPLOAD_BYTES` default 10485760.
- Local creds for Floci: `AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test`, region `us-east-1`, bucket `plant-media`.
- DB: user/pass/db `plant/plant/plant`, integration tests use DB `plant_test` via `TEST_DATABASE_URL`.
- **Commit AND push as often as possible** (user request): after each green test step, each component, each config change — small conventional commits with the `Co-Authored-By` trailer, `git push` right after each commit.
- **No learning checkpoints in app code** (user request): the user's learning focus is only the Terraform/AWS deployment (Plan 2). Implement 🎓-marked functions directly using the reference implementation.

---

## Shared API contract (both halves implement exactly this)

```ts
// frontend/src/types.ts
export interface Plant {
  id: string; name: string; species: string; location: string; notes: string;
  water_every_days: number;
  last_watered_on: string;   // YYYY-MM-DD
  next_water_on: string;     // YYYY-MM-DD
  days_until_water: number;  // <= 0 → thirsty
  created_at: string; updated_at: string;
}
export interface PlantSummary extends Plant { cover_media_id: string | null; media_count: number; }
export interface Media { id: string; plant_id: string; filename: string; content_type: string; size_bytes: number; caption: string; created_at: string; }
export interface Watering { id: string; plant_id: string; watered_on: string; created_at: string; }
export interface PlantDetail extends Plant { media: Media[]; waterings: Watering[]; }
export interface NewPlant { name: string; species?: string; location?: string; notes?: string; water_every_days: number; last_watered_on?: string; }
export type PlantPatch = Partial<Omit<NewPlant, 'last_watered_on'>>;
```

Go mirrors these in `internal/store/models.go` with identical JSON tags (`S3Key` is `json:"-"`).

---

## Stage 1 — Frontend

### Task 1: Scaffold frontend with Tailwind, shadcn/ui, test tooling, API client

**Files:**
- Create: `frontend/` (via `npm create vite@latest frontend -- --template react-ts`)
- Create: `frontend/src/types.ts` (contract above), `frontend/src/api.ts`, `frontend/src/api.test.ts`, `frontend/src/setupTests.ts`
- Modify: `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.app.json`, `frontend/package.json`

**Interfaces — Produces:**
```ts
export class ApiError extends Error { status: number }
export function errorMessage(e: unknown): string
export const api: {
  listPlants(): Promise<PlantSummary[]>;
  getPlant(id: string): Promise<PlantDetail>;
  createPlant(p: NewPlant): Promise<Plant>;
  updatePlant(id: string, p: PlantPatch): Promise<Plant>;
  deletePlant(id: string): Promise<void>;
  waterPlant(id: string, wateredOn?: string): Promise<Plant>;
  uploadMedia(plantId: string, file: File, caption?: string): Promise<Media>;
  deleteMedia(id: string): Promise<void>;
  mediaUrl(id: string): string;           // "/api/media/<id>"
}
```

- [ ] **Step 1:** Scaffold: `npm create vite@latest frontend -- --template react-ts`, `cd frontend && npm install`.
- [ ] **Step 2:** Install: `npm i tailwindcss @tailwindcss/vite react-router lucide-react` and `npm i -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/node`.
- [ ] **Step 3:** Configure Vite: plugins `[react(), tailwindcss()]`, alias `@` → `./src`, `server.proxy: { '/api': 'http://localhost:8080' }`, `test: { environment: 'jsdom', globals: true, setupFiles: './src/setupTests.ts' }`. Add `"baseUrl": "."` + `"paths": {"@/*": ["./src/*"]}` to both tsconfig files (required by shadcn). `setupTests.ts`: `import '@testing-library/jest-dom/vitest'`. Script `"test": "vitest run"`.
- [ ] **Step 4:** `src/index.css` → `@import "tailwindcss";` then run `npx shadcn@latest init` (base color: stone/green theme) and `npx shadcn@latest add button card dialog input label textarea badge sonner`.
- [ ] **Step 5: Write failing tests** `src/api.test.ts` (stub `fetch` with `vi.stubGlobal`):
  - `listPlants` calls `fetch('/api/plants', undefined)` and returns the parsed body.
  - `createPlant` sends `POST`, `Content-Type: application/json`, and a JSON body.
  - a non-2xx response with `{"error":"name is required"}` rejects with an `ApiError` whose `status` is 400 and whose `message` is `"name is required"`.
  - a 204 resolves to `undefined`.
  - `uploadMedia` sends `FormData` with `file` and `caption`.
  - `mediaUrl('abc') === '/api/media/abc'`.
- [ ] **Step 6:** Run `npm test`. Expected: FAIL (module missing).
- [ ] **Step 7: Implement `api.ts`:**
```ts
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try { const body = await res.json(); if (body?.error) message = body.error; } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
```
- [ ] **Step 8:** `npm test && npm run build`. Expected: PASS, build OK.
- [ ] **Step 9:** Commit `feat(frontend): scaffold Vite + Tailwind + shadcn and typed API client`.

### Task 2: Water-schedule logic + Garden page

**Files:**
- Create: `src/lib/water.ts`, `src/lib/water.test.ts`, `src/components/WaterBadge.tsx`, `src/components/PlantCard.tsx`, `src/components/PlantFormDialog.tsx`, `src/pages/GardenPage.tsx`, `src/components/Layout.tsx`, `src/components/PlantCard.test.tsx`
- Modify: `src/App.tsx` (router), `src/main.tsx` (Toaster), delete template assets

**Interfaces — Produces:**
```ts
export type WaterStatus = { tone: 'overdue' | 'today' | 'soon' | 'ok'; label: string };
export function waterStatus(daysUntil: number): WaterStatus  // 🎓 learning checkpoint
export function PlantFormDialog(props: { trigger: ReactNode; initial?: Plant; onSubmit(p: NewPlant): Promise<void> }): JSX.Element
export function PlantCard(props: { plant: PlantSummary; onWater(id: string): Promise<void> }): JSX.Element
```

- [ ] **Step 1: Failing tests** `water.test.ts`: `-3 → {tone:'overdue', label:'3d overdue'}`, `0 → {tone:'today', label:'Water today'}`, `1 → {tone:'soon', label:'Tomorrow'}`, `2 → {tone:'soon', label:'In 2 days'}`, `5 → {tone:'ok', label:'In 5 days'}`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: 🎓 User writes `waterStatus`.** Reference:
```ts
export function waterStatus(d: number): WaterStatus {
  if (d < 0) return { tone: 'overdue', label: `${-d}d overdue` };
  if (d === 0) return { tone: 'today', label: 'Water today' };
  if (d === 1) return { tone: 'soon', label: 'Tomorrow' };
  if (d <= 2) return { tone: 'soon', label: `In ${d} days` };
  return { tone: 'ok', label: `In ${d} days` };
}
```
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Build `WaterBadge` (shadcn `Badge`, color by tone: overdue=red, today=amber, soon=sky, ok=emerald, 💧 icon), `PlantCard` (cover image `api.mediaUrl(cover_media_id)` or a leafy gradient placeholder with a `Sprout` icon; name, species, location, WaterBadge, **Water** button → `onWater`, whole card links to `/plants/:id`), `PlantFormDialog` (name*, species, location, water every N days*, last watered date, notes; validates name non-empty and 1–365 days before submit), `GardenPage` (loads `api.listPlants()`, "Thirsty" section for `days_until_water <= 0`, responsive grid `sm:grid-cols-2 lg:grid-cols-3`, empty state with a big 🌱 and an Add button; toasts on error via `sonner`), `Layout` (header "🌱 Plant Parent" + `<Outlet/>`).
- [ ] **Step 6: Component test** `PlantCard.test.tsx` (wrap in `MemoryRouter`): renders name and "Water today" for `days_until_water: 0`; clicking **Water** calls `onWater(plant.id)` and does not navigate; `<img>` is rendered when `cover_media_id` is set, not when it is null.
- [ ] **Step 7:** `npm test && npm run build` → PASS.
- [ ] **Step 8:** Commit `feat(frontend): garden page with water schedule badges`.

### Task 3: Plant page — timeline, uploads, edit/delete

**Files:**
- Create: `src/lib/timeline.ts`, `src/lib/timeline.test.ts`, `src/pages/PlantPage.tsx`, `src/components/MediaDropzone.tsx`, `src/components/Timeline.tsx`, `src/components/PhotoViewer.tsx`, `src/lib/format.ts`

**Interfaces — Produces:**
```ts
export type TimelineItem =
  | { kind: 'media'; date: string; media: Media }
  | { kind: 'water'; date: string; watering: Watering };
export function buildTimeline(media: Media[], waterings: Watering[]): TimelineItem[] // newest first; media date = created_at, water date = watered_on
export const INLINE_IMAGE_TYPES: ReadonlySet<string> // png/jpeg/gif/webp
export function formatBytes(n: number): string       // "512 B", "1.5 KB", "2.0 MB"
```

- [ ] **Step 1: Failing tests** `timeline.test.ts`: merges both lists sorted newest first; a watering on 2026-09-20 sorts after a photo created 2026-09-21T10:00Z; empty inputs → `[]`. Plus `formatBytes(512)`, `formatBytes(1536)`, `formatBytes(2*1024*1024)`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (compare `date` strings via `Date.parse`, sort desc). **Step 4:** Run → PASS.
- [ ] **Step 5:** Build `PlantPage` (loads `api.getPlant(id)`; header card with WaterBadge + **Water now** + **Edit** (reuse `PlantFormDialog` with `initial`) + **Delete** (confirm dialog → `navigate('/')`)); `MediaDropzone` (drag-and-drop + click, optional caption input, shows "Uploading…" while busy, uploads files sequentially, calls `onUploaded` to reload); `Timeline` (vertical line; photo items as rounded thumbnails that open `PhotoViewer` dialog; non-image media as file chips with icon + size + download link; watering items as 💧 "Watered"; each item has a delete button for media).
- [ ] **Step 6:** `npm test && npm run build` → PASS.
- [ ] **Step 7:** Commit `feat(frontend): plant page with timeline and uploads`; `git push`.

---

## Stage 2 — Backend

### Task 4: Go module, config, local infra

**Files:**
- Create: `backend/go.mod`, `backend/internal/config/config.go`, `backend/internal/config/config_test.go`, `docker-compose.yml`, `dev/postgres-init.sql`, `Makefile`, `backend/.env.example`

**Interfaces — Produces:**
```go
type Config struct { Port, DatabaseURL, S3Bucket, AWSEndpointURL, AWSRegion string; MaxUploadBytes int64 }
func Load() (Config, error) // errors list ALL missing required vars (DATABASE_URL, S3_BUCKET); defaults PORT=8080, AWS_REGION=us-east-1, MAX_UPLOAD_BYTES=10485760
```

- [ ] **Step 1: Failing tests** (`t.Setenv`): defaults applied; missing both required → error mentioning both names; `MAX_UPLOAD_BYTES=abc` and `=0` → error; `AWS_ENDPOINT_URL` passed through.
- [ ] **Step 2:** `go test ./...` → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** `docker-compose.yml`: `postgres:16-alpine` (env plant/plant/plant, port 5432, named volume, `pg_isready` healthcheck, mounts `./dev/postgres-init.sql` into `/docker-entrypoint-initdb.d/`), `floci/floci:latest` (port 4566). `dev/postgres-init.sql`: `CREATE DATABASE plant_test;`.
- [ ] **Step 6:** `Makefile` exporting the env from Global Constraints plus `TEST_DATABASE_URL`, with targets: `up` (`docker compose up -d --wait` then `bucket`), `down`, `bucket` (`aws --endpoint-url $(AWS_ENDPOINT_URL) s3api head-bucket … || aws … s3 mb s3://$(S3_BUCKET)`), `backend`, `frontend`, `test-backend`, `test-frontend`, `test`.
- [ ] **Step 7:** `make up` → both containers healthy, bucket exists (`aws --endpoint-url http://localhost:4566 s3 ls`).
- [ ] **Step 8:** Commit `feat(backend): config loading and local dev infrastructure`.

### Task 5: Store — migrations + plants + waterings

**Files:**
- Create: `internal/store/models.go`, `internal/store/migrate.go`, `internal/store/migrations/001_init.sql` (schema from spec + `CREATE INDEX` on `media(plant_id)` and `waterings(plant_id)`), `internal/store/plants.go`, `internal/store/store_test.go`

**Interfaces — Produces:**
```go
var ErrNotFound = errors.New("not found")
func Migrate(ctx context.Context, pool *pgxpool.Pool) error
type Postgres struct{ pool *pgxpool.Pool }
func New(pool *pgxpool.Pool) *Postgres
func (s *Postgres) Ping(ctx) error
func (s *Postgres) ListPlants(ctx) ([]PlantSummary, error)
func (s *Postgres) GetPlant(ctx, id uuid.UUID) (PlantDetail, error)
func (s *Postgres) CreatePlant(ctx, in NewPlant) (Plant, error)
func (s *Postgres) UpdatePlant(ctx, id uuid.UUID, p PlantPatch) (Plant, error)
func (s *Postgres) DeletePlant(ctx, id uuid.UUID) error
func (s *Postgres) WaterPlant(ctx, id uuid.UUID, on string) (Plant, error) // tx: insert watering + set last_watered_on = GREATEST(last_watered_on, on)
```
Models: `Plant`, `PlantSummary{Plant; CoverMediaID *uuid.UUID; MediaCount int}` (embedded, JSON flattened), `PlantDetail{Plant; Media []Media; Waterings []Watering}`, `NewPlant`, `PlantPatch` (all pointer fields), `Media`, `Watering`. Dates are `string` (`YYYY-MM-DD`), read with `::text` and written with `$n::date`.

Key SQL:
```sql
-- plant columns incl. derived fields
id, name, species, location, notes, water_every_days, last_watered_on::text,
(last_watered_on + water_every_days)::text AS next_water_on,
(last_watered_on + water_every_days) - CURRENT_DATE AS days_until_water,
created_at, updated_at

-- summary extras
(SELECT m.id FROM media m WHERE m.plant_id = p.id
   AND m.content_type IN ('image/png','image/jpeg','image/gif','image/webp')
   ORDER BY m.created_at DESC LIMIT 1) AS cover_media_id,
(SELECT count(*) FROM media m WHERE m.plant_id = p.id) AS media_count
... ORDER BY next_water_on ASC, name ASC
```
`Migrate`: acquire a conn, `SELECT pg_advisory_lock(727274)`, create `schema_migrations`, apply each unapplied embedded file in name order inside its own tx, `pg_advisory_unlock` on exit.

- [ ] **Step 1: Failing integration tests** (helper `newTestStore(t)` skips without `TEST_DATABASE_URL`, runs `Migrate`, `TRUNCATE plants CASCADE`): Migrate is idempotent (run twice); create → get round-trip with `next_water_on`/`days_until_water` computed correctly (last watered 3 days ago, every 7 → `days_until_water == 4`); list sorts thirstiest first; `UpdatePlant` changes only given fields and bumps `updated_at`; unknown ID → `ErrNotFound` for get/update/delete/water; `WaterPlant` inserts a watering and never moves `last_watered_on` backwards.
- [ ] **Step 2:** `make test-backend` → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(backend): postgres store for plants and waterings`.

### Task 6: Store — media

**Files:** Create `internal/store/media.go`; Modify `store_test.go`

**Interfaces — Produces:**
```go
func (s *Postgres) CreateMedia(ctx, m Media) (Media, error)   // caller sets ID + S3Key; FK violation (23503) → ErrNotFound
func (s *Postgres) GetMedia(ctx, id uuid.UUID) (Media, error)
func (s *Postgres) ListMediaForPlant(ctx, plantID uuid.UUID) ([]Media, error)
func (s *Postgres) DeleteMedia(ctx, id uuid.UUID) error
```
- [ ] **Step 1: Failing tests:** create/get/delete round-trip; create for a missing plant → `ErrNotFound`; `GetPlant` includes media newest first; `ListPlants` `cover_media_id` = newest *image* (a newer PDF is ignored) and `media_count` counts all; deleting a plant cascades media rows.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(backend): media persistence`.

### Task 7: S3 file storage

**Files:** Create `internal/storage/storage.go`, `internal/storage/s3.go`, `internal/storage/s3_test.go`

**Interfaces — Produces:**
```go
var ErrNotFound = errors.New("object not found")
type FileStorage interface {
  Put(ctx context.Context, key string, body io.ReadSeeker, size int64, contentType string) error
  Get(ctx context.Context, key string) (io.ReadCloser, error)
  Delete(ctx context.Context, key string) error
}
func NewS3(ctx context.Context, region, endpoint, bucket string) (*S3, error)
```
`NewS3`: `config.LoadDefaultConfig(ctx, config.WithRegion(region))`; if `endpoint != ""` set `o.BaseEndpoint` and `o.UsePathStyle = true`; set `RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired` (emulator compatibility). `Get` maps `*types.NoSuchKey` → `ErrNotFound`. `body` is `io.ReadSeeker` because the SDK must rewind to sign over plain HTTP.

- [ ] **Step 1: Failing test** (skips unless `AWS_ENDPOINT_URL` and `S3_BUCKET` are set): put → get returns identical bytes → delete → get returns `ErrNotFound`.
- [ ] **Step 2–4:** FAIL → implement → PASS (with `make up` running).
- [ ] **Step 5:** Commit `feat(backend): S3 file storage`.

### Task 8: HTTP handlers

**Files:** Create `internal/handler/handler.go` (Store interface, `New`, `Register`, `errJSON`, `fail`, `pathID`), `plants.go`, `media.go`, `validate.go`, `fakes_test.go`, `plants_test.go`, `media_test.go`

**Interfaces — Consumes:** all store methods above + `storage.FileStorage`.
**Produces:** `func New(s Store, f storage.FileStorage, maxUpload int64) *Handler`, `func (h *Handler) Register(e *echo.Echo)` (routes exactly as in the spec table).

Behavior rules:
- `fail`: `store.ErrNotFound` → 404 `"not found"`, `storage.ErrNotFound` → 404 `"file not found in storage"`, otherwise log with `slog` and 500 `"internal error"`.
- Bad UUID → 400 `"invalid id"`. Bad JSON → 400 `"invalid JSON body"`.
- `DELETE /plants/:id`: `ListMediaForPlant` → delete each S3 object (abort with 500 on failure) → `DeletePlant`.
- Upload: check the plant exists → `http.MaxBytesReader(max + 1 MiB)` → `c.FormFile("file")` (a `*http.MaxBytesError` → 413) → `validateUpload` → `Put` → `CreateMedia`; if `CreateMedia` fails, `Delete` the object and log orphans.
- Download: `Content-Disposition` via `mime.FormatMediaType(inline|attachment, {"filename": name})`, `X-Content-Type-Options: nosniff`, `c.Stream`.

- [ ] **Step 1: Failing tests** with in-memory `fakeStore`/`fakeFiles` (maxUpload = 1024 in tests):
  - health 200; health 503 when `Ping` errors
  - create 201; blank name 400; `water_every_days` 0 and 366 → 400; bad date → 400
  - list 200 returns the fake's plants; get unknown → 404; get bad uuid → 400
  - patch partial 200; patch unknown → 404
  - water with no body uses today; a future `watered_on` → 400
  - delete removes the plant's S3 objects then the plant (204); S3 delete failure → 500 and the plant still exists
  - upload 201 stores bytes under `plants/<plantID>/<mediaID>` with the caption; missing plant → 404; no file field → 400; empty file → 400; 2048-byte file → 413; `CreateMedia` failure → 500 and the S3 object removed
  - download streams bytes; png is `inline`; svg is `attachment`; `nosniff` set
  - delete media 204 and the object is gone
- [ ] **Step 2:** `go test ./internal/handler/` → FAIL.
- [ ] **Step 3: 🎓 User writes `validateUpload(fh *multipart.FileHeader, maxBytes int64) error`** (trade-off: allow any file type vs an allowlist). Reference:
```go
var errTooLarge = errors.New("file too large")
func validateUpload(fh *multipart.FileHeader, maxBytes int64) error {
	if fh.Size == 0 { return errors.New("file is empty") }
	if fh.Size > maxBytes { return fmt.Errorf("%w: max %d bytes", errTooLarge, maxBytes) }
	return nil
}
```
- [ ] **Step 4:** Implement the handlers + other validators (`validateName` 1–100 runes trimmed, `validateInterval` 1–365, `validateDate` `time.DateOnly` + optional not-in-future). Run → PASS.
- [ ] **Step 5:** Commit `feat(backend): REST handlers for plants and media`; `git push`.

---

## Stage 3 — Run locally

### Task 9: Server wiring

**Files:** Create `backend/cmd/server/main.go`

- [ ] **Step 1:** `main` → `run() error`: JSON `slog` default logger; `config.Load`; `signal.NotifyContext(SIGINT, SIGTERM)`; `pgxpool.New`; `store.Migrate`; `storage.NewS3`; Echo with `HideBanner`, `middleware.Recover()`, `middleware.RequestLoggerWithConfig` (method, uri, status, latency → slog); `handler.New(...).Register(e)`; start in a goroutine; on signal `e.Shutdown` with a 10s timeout.
- [ ] **Step 2: Smoke with curl** (with `make up` and `make backend` running):
```bash
curl -s localhost:8080/api/health
ID=$(curl -s -XPOST localhost:8080/api/plants -H 'Content-Type: application/json' -d '{"name":"Monstera","water_every_days":7}' | jq -r .id)
curl -s -F file=@some-photo.jpg -F caption="new leaf" localhost:8080/api/plants/$ID/media
curl -s localhost:8080/api/plants | jq
curl -s -XPOST localhost:8080/api/plants/$ID/water | jq .days_until_water   # → 7
aws --endpoint-url http://localhost:4566 s3 ls s3://plant-media --recursive   # object is in Floci S3
```
- [ ] **Step 3:** Commit `feat(backend): server entrypoint with graceful shutdown`.

### Task 10: End-to-end in the browser + docs

- [ ] **Step 1:** `make up`, `make backend`, `make frontend`; open http://localhost:5173. Add 3 plants, upload a photo and a PDF, water one, delete one. Check the Thirsty strip, cover photo, timeline, photo viewer, dark mode and mobile width (Playwright screenshot).
- [ ] **Step 2:** Fix anything found (each fix gets a test where practical).
- [ ] **Step 3:** README "Run it locally" section (prereqs, `make up`, `make backend`, `make frontend`, `make test`, how to inspect Floci S3 with the AWS CLI).
- [ ] **Step 4:** `make test` → all green. Commit `docs: local development guide`; `git push`.
