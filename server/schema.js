// Datenbankschema. Der Worker legt es beim ersten Aufruf selbst an (idempotent),
// damit nach einem Git-Push keine Migration von Hand nötig ist.
// Spätere Änderungen: neue Einträge an MIGRATIONS anhängen, nie bestehende ändern.

export const SCHEMA = `
-- Reisebande: Grundschema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dest TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'stadt',
  start TEXT,                       -- YYYY-MM-DD
  end TEXT,
  tz TEXT NOT NULL DEFAULT 'Europe/Berlin',       -- Zeitzone am Reiseziel
  home_tz TEXT NOT NULL DEFAULT 'Europe/Berlin',
  maps_url TEXT NOT NULL DEFAULT '',
  maps_synced_at INTEGER,
  briefing_hour INTEGER NOT NULL DEFAULT 20,
  last_briefing TEXT,               -- Datum (Ortszeit), an dem zuletzt verschickt wurde
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2F4BFF',
  role TEXT NOT NULL DEFAULT 'member',   -- admin | member
  token_hash TEXT NOT NULL UNIQUE,
  claimed INTEGER NOT NULL DEFAULT 1,    -- 0 = vorab angelegt, wartet auf die Person (Platz in der Einladung)
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

-- Einladungslinks der Reiseleitung. Gespeichert ist nur der Hash des Codes.
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  created_by TEXT,
  uses_left INTEGER,                     -- NULL = beliebig oft
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS members_trip ON members(trip_id);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  cat TEXT NOT NULL DEFAULT 'Sehen',
  note TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  approx INTEGER NOT NULL DEFAULT 0,     -- Koordinaten nur ungefähr
  url TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',        -- Bild-URL (https) oder file:<id> für ein eigenes Foto
  image_credit TEXT NOT NULL DEFAULT '', -- JSON { t: Quelle, l: Link }
  image_tried INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | maps | import
  source_ref TEXT,                       -- z. B. Google-Kennung, für den Abgleich
  day TEXT,                              -- YYYY-MM-DD oder NULL = noch ohne Tag
  time TEXT NOT NULL DEFAULT '',
  ord REAL NOT NULL DEFAULT 0,
  booked INTEGER NOT NULL DEFAULT 0,
  hours REAL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS places_trip ON places(trip_id, deleted);
CREATE UNIQUE INDEX IF NOT EXISTS places_ref ON places(trip_id, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS hearts (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (place_id, member_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  target TEXT NOT NULL,                  -- place:<id> | day:<YYYY-MM-DD> | trip
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '',
  file_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_trip ON comments(trip_id, target);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Flüge, Unterkunft und Anreise
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                    -- flight | stay | transport
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',       -- JSON, je nach Art (Zeitraum, Link, Status)
  ord REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_trip ON items(trip_id, kind);

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

// Zusätzliche Schritte für spätere Versionen (Index = Version - 1)
export const MIGRATIONS = [];
