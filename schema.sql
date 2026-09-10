-- Run this once in the D1 console after creating the database.

CREATE TABLE IF NOT EXISTS series (
  room     TEXT    NOT NULL,
  id       TEXT    NOT NULL,
  created  INTEGER NOT NULL,
  sdate    TEXT    NOT NULL DEFAULT '',   -- date played, YYYY-MM-DD
  updated  INTEGER NOT NULL,
  deleted  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room, id)
);

CREATE TABLE IF NOT EXISTS matches (
  room       TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  series_id  TEXT    NOT NULL,
  ord        INTEGER NOT NULL DEFAULT 0,
  pa         TEXT    NOT NULL,
  pb         TEXT    NOT NULL,
  ga         INTEGER NOT NULL DEFAULT 0,
  gb         INTEGER NOT NULL DEFAULT 0,
  ta         TEXT    NOT NULL DEFAULT '',
  tb         TEXT    NOT NULL DEFAULT '',
  sc         TEXT    NOT NULL DEFAULT '',   -- goalscorers, JSON array
  v          TEXT    NOT NULL DEFAULT '',   -- game version, e.g. 'FC 26'
  updated    INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room, id)
);

CREATE INDEX IF NOT EXISTS idx_matches_room ON matches (room);

-- Player names, teams, series length and carry-over numbers.
-- One blob per room, last write wins.
CREATE TABLE IF NOT EXISTS settings (
  room     TEXT    PRIMARY KEY,
  json     TEXT    NOT NULL,
  updated  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- MIGRATION for databases created before goalscorers were added.
-- Safe to skip on a fresh database; it errors harmlessly if the column exists.
-- ALTER TABLE matches ADD COLUMN sc TEXT NOT NULL DEFAULT '';
-- ALTER TABLE matches ADD COLUMN v  TEXT NOT NULL DEFAULT '';
-- ALTER TABLE series  ADD COLUMN sdate TEXT NOT NULL DEFAULT '';
-- ---------------------------------------------------------------------------
