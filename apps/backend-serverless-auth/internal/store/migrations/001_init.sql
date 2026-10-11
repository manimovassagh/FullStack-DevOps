CREATE TABLE plants (
  id                UUID PRIMARY KEY,
  name              TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  species           TEXT NOT NULL DEFAULT '',
  location          TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  water_every_days  INT  NOT NULL CHECK (water_every_days BETWEEN 1 AND 365),
  last_watered_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE waterings (
  id          UUID PRIMARY KEY,
  plant_id    UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  watered_on  DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX waterings_plant_id_idx ON waterings(plant_id);

CREATE TABLE media (
  id            UUID PRIMARY KEY,
  plant_id      UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  caption       TEXT NOT NULL DEFAULT '',
  s3_key        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX media_plant_id_idx ON media(plant_id);
