package store

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Integration tests: they need the compose Postgres (`make up`) and use the
// separate plant_test database so they never touch your dev data.
// asAlice is the context every test runs in unless it says otherwise: a signed-in, non-admin user.
func asAlice() context.Context { return WithOwner(context.Background(), Owner{ID: "alice"}) }

func newTestStore(t *testing.T) (*Postgres, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; run `make up` then `make test-backend`")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE plants CASCADE`); err != nil {
		t.Fatal(err)
	}
	return New(pool), pool
}

// daysAgo asks Postgres (not Go) for the date, so both sides agree on "today".
func daysAgo(t *testing.T, pool *pgxpool.Pool, n int) string {
	t.Helper()
	var d string
	if err := pool.QueryRow(asAlice(), `SELECT (CURRENT_DATE - $1::int)::text`, n).Scan(&d); err != nil {
		t.Fatal(err)
	}
	return d
}

func mustCreate(t *testing.T, s *Postgres, in NewPlant) Plant {
	t.Helper()
	p, err := s.CreatePlant(asAlice(), in)
	if err != nil {
		t.Fatalf("CreatePlant: %v", err)
	}
	return p
}

func TestMigrateIsIdempotent(t *testing.T) {
	_, pool := newTestStore(t)
	if err := Migrate(asAlice(), pool); err != nil {
		t.Fatalf("second Migrate: %v", err)
	}
}

func TestCreateAndGetPlantComputesSchedule(t *testing.T) {
	s, pool := newTestStore(t)
	ctx := asAlice()

	created := mustCreate(t, s, NewPlant{Name: "Monstera", Species: "M. deliciosa", WaterEveryDays: 7, LastWateredOn: new(daysAgo(t, pool, 3))})
	if created.DaysUntilWater != 4 {
		t.Errorf("DaysUntilWater = %d, want 4", created.DaysUntilWater)
	}
	if created.NextWaterOn != daysAgo(t, pool, -4) {
		t.Errorf("NextWaterOn = %s, want %s", created.NextWaterOn, daysAgo(t, pool, -4))
	}

	got, err := s.GetPlant(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetPlant: %v", err)
	}
	if got.Name != "Monstera" || got.Species != "M. deliciosa" {
		t.Errorf("got %+v", got.Plant)
	}
	if got.Media == nil || got.Waterings == nil {
		t.Error("Media/Waterings must be empty slices, not nil (JSON [] not null)")
	}
}

func TestCreatePlantDefaultsLastWateredToToday(t *testing.T) {
	s, pool := newTestStore(t)
	p := mustCreate(t, s, NewPlant{Name: "Basil", WaterEveryDays: 2})
	if p.LastWateredOn != daysAgo(t, pool, 0) || p.DaysUntilWater != 2 {
		t.Errorf("got last=%s days=%d", p.LastWateredOn, p.DaysUntilWater)
	}
}

func TestListPlantsThirstiestFirst(t *testing.T) {
	s, pool := newTestStore(t)
	mustCreate(t, s, NewPlant{Name: "Cactus", WaterEveryDays: 30})
	mustCreate(t, s, NewPlant{Name: "Fern", WaterEveryDays: 2, LastWateredOn: new(daysAgo(t, pool, 5))})
	mustCreate(t, s, NewPlant{Name: "Basil", WaterEveryDays: 3})

	list, err := s.ListPlants(asAlice())
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, p := range list {
		names = append(names, p.Name)
	}
	if len(names) != 3 || names[0] != "Fern" || names[1] != "Basil" || names[2] != "Cactus" {
		t.Errorf("order = %v, want [Fern Basil Cactus]", names)
	}
	if list[0].DaysUntilWater != -3 {
		t.Errorf("Fern DaysUntilWater = %d, want -3", list[0].DaysUntilWater)
	}
}

func TestUpdatePlantPartial(t *testing.T) {
	s, _ := newTestStore(t)
	p := mustCreate(t, s, NewPlant{Name: "Pothos", Species: "Epipremnum", WaterEveryDays: 7})
	time.Sleep(5 * time.Millisecond)

	u, err := s.UpdatePlant(asAlice(), p.ID, PlantPatch{WaterEveryDays: new(10), Location: new("Kitchen")})
	if err != nil {
		t.Fatal(err)
	}
	if u.Name != "Pothos" || u.Species != "Epipremnum" || u.WaterEveryDays != 10 || u.Location != "Kitchen" {
		t.Errorf("got %+v", u)
	}
	if !u.UpdatedAt.After(p.UpdatedAt) {
		t.Error("updated_at was not bumped")
	}
}

func TestUnknownPlantIsNotFound(t *testing.T) {
	s, _ := newTestStore(t)
	ctx, id := asAlice(), uuid.New()

	if _, err := s.GetPlant(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetPlant: %v", err)
	}
	if _, err := s.UpdatePlant(ctx, id, PlantPatch{Name: new("x")}); !errors.Is(err, ErrNotFound) {
		t.Errorf("UpdatePlant: %v", err)
	}
	if err := s.DeletePlant(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Errorf("DeletePlant: %v", err)
	}
	if _, err := s.WaterPlant(ctx, id, nil); !errors.Is(err, ErrNotFound) {
		t.Errorf("WaterPlant: %v", err)
	}
	if _, err := s.CreateMedia(ctx, Media{ID: uuid.New(), PlantID: id, Filename: "a", ContentType: "b", S3Key: "k"}); !errors.Is(err, ErrNotFound) {
		t.Errorf("CreateMedia: %v", err)
	}
}

func TestWaterPlant(t *testing.T) {
	s, pool := newTestStore(t)
	ctx := asAlice()
	p := mustCreate(t, s, NewPlant{Name: "Fern", WaterEveryDays: 3, LastWateredOn: new(daysAgo(t, pool, 5))})

	watered, err := s.WaterPlant(ctx, p.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if watered.LastWateredOn != daysAgo(t, pool, 0) || watered.DaysUntilWater != 3 {
		t.Errorf("after watering: last=%s days=%d", watered.LastWateredOn, watered.DaysUntilWater)
	}

	// Logging an older watering must not move last_watered_on backwards.
	back, err := s.WaterPlant(ctx, p.ID, new(daysAgo(t, pool, 2)))
	if err != nil {
		t.Fatal(err)
	}
	if back.LastWateredOn != daysAgo(t, pool, 0) {
		t.Errorf("last_watered_on moved back to %s", back.LastWateredOn)
	}

	detail, _ := s.GetPlant(ctx, p.ID)
	if len(detail.Waterings) != 2 || detail.Waterings[0].WateredOn != daysAgo(t, pool, 0) {
		t.Errorf("waterings = %+v", detail.Waterings)
	}
}

func TestMediaLifecycleAndCover(t *testing.T) {
	s, _ := newTestStore(t)
	ctx := asAlice()
	p := mustCreate(t, s, NewPlant{Name: "Monstera", WaterEveryDays: 7})

	add := func(ct string) Media {
		t.Helper()
		id := uuid.New()
		m, err := s.CreateMedia(ctx, Media{ID: id, PlantID: p.ID, Filename: "f", ContentType: ct, SizeBytes: 3, Caption: "hi", S3Key: "plants/x/" + id.String()})
		if err != nil {
			t.Fatalf("CreateMedia: %v", err)
		}
		time.Sleep(5 * time.Millisecond) // distinct created_at for ordering
		return m
	}
	oldPhoto := add("image/png")
	newPhoto := add("image/jpeg")
	pdf := add("application/pdf") // newest, but not an image → never the cover

	got, err := s.GetMedia(ctx, newPhoto.ID)
	if err != nil || got.Caption != "hi" || got.S3Key == "" {
		t.Fatalf("GetMedia: %+v %v", got, err)
	}

	list, _ := s.ListPlants(ctx)
	if list[0].CoverMediaID == nil || *list[0].CoverMediaID != newPhoto.ID {
		t.Errorf("cover = %v, want newest image %v", list[0].CoverMediaID, newPhoto.ID)
	}
	if list[0].MediaCount != 3 {
		t.Errorf("MediaCount = %d, want 3", list[0].MediaCount)
	}

	detail, _ := s.GetPlant(ctx, p.ID)
	if len(detail.Media) != 3 || detail.Media[0].ID != pdf.ID || detail.Media[2].ID != oldPhoto.ID {
		t.Errorf("media not newest-first: %+v", detail.Media)
	}

	if err := s.DeleteMedia(ctx, pdf.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetMedia(ctx, pdf.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleted media still there: %v", err)
	}

	// Deleting the plant cascades to its media rows.
	if err := s.DeletePlant(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetMedia(ctx, oldPhoto.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("media survived plant delete: %v", err)
	}
}

func TestOwnersOnlySeeTheirOwnPlants(t *testing.T) {
	s, _ := newTestStore(t)
	bob := WithOwner(context.Background(), Owner{ID: "bob"})
	admin := WithOwner(context.Background(), Owner{ID: "root", Admin: true})

	mine := mustCreate(t, s, NewPlant{Name: "Alice fern", WaterEveryDays: 7})
	theirs, err := s.CreatePlant(bob, NewPlant{Name: "Bob cactus", WaterEveryDays: 30})
	if err != nil {
		t.Fatal(err)
	}

	list, err := s.ListPlants(asAlice())
	if err != nil || len(list) != 1 || list[0].ID != mine.ID {
		t.Fatalf("alice should see only her plant, got %v (err %v)", list, err)
	}
	all, err := s.ListPlants(admin)
	if err != nil || len(all) != 2 {
		t.Fatalf("admin should see both plants, got %d (err %v)", len(all), err)
	}

	// Every operation on someone else's plant behaves as if it does not exist.
	if _, err := s.GetPlant(asAlice(), theirs.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetPlant: want ErrNotFound, got %v", err)
	}
	name := "hijacked"
	if _, err := s.UpdatePlant(asAlice(), theirs.ID, PlantPatch{Name: &name}); !errors.Is(err, ErrNotFound) {
		t.Errorf("UpdatePlant: want ErrNotFound, got %v", err)
	}
	if _, err := s.WaterPlant(asAlice(), theirs.ID, nil); !errors.Is(err, ErrNotFound) {
		t.Errorf("WaterPlant: want ErrNotFound, got %v", err)
	}
	if err := s.DeletePlant(asAlice(), theirs.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("DeletePlant: want ErrNotFound, got %v", err)
	}
	if _, err := s.GetPlant(admin, theirs.ID); err != nil {
		t.Errorf("admin GetPlant: %v", err)
	}
}

func TestMediaFollowsItsPlantsOwner(t *testing.T) {
	s, _ := newTestStore(t)
	bob := WithOwner(context.Background(), Owner{ID: "bob"})
	p, err := s.CreatePlant(bob, NewPlant{Name: "Bob cactus", WaterEveryDays: 30})
	if err != nil {
		t.Fatal(err)
	}
	m, err := s.CreateMedia(bob, Media{ID: uuid.New(), PlantID: p.ID, Filename: "a.png", ContentType: "image/png", SizeBytes: 1, S3Key: "k"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.GetMedia(asAlice(), m.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetMedia: want ErrNotFound, got %v", err)
	}
	if list, err := s.ListMediaForPlant(asAlice(), p.ID); err != nil || len(list) != 0 {
		t.Errorf("ListMediaForPlant: want empty, got %v (err %v)", list, err)
	}
	if err := s.DeleteMedia(asAlice(), m.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("DeleteMedia: want ErrNotFound, got %v", err)
	}
	if _, err := s.GetMedia(bob, m.ID); err != nil {
		t.Errorf("owner GetMedia: %v", err)
	}
}

func TestStoreRefusesToRunWithoutAnOwner(t *testing.T) {
	s, _ := newTestStore(t)
	if _, err := s.ListPlants(context.Background()); !errors.Is(err, ErrNoOwner) {
		t.Errorf("want ErrNoOwner, got %v", err)
	}
	if _, err := s.CreatePlant(context.Background(), NewPlant{Name: "x", WaterEveryDays: 1}); !errors.Is(err, ErrNoOwner) {
		t.Errorf("want ErrNoOwner, got %v", err)
	}
}
