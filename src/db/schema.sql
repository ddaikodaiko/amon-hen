-- Vigía v1, schema version 1. Tables and rules in specs/001-vigia-v1/data-model.md.
-- Times are UTC milliseconds since epoch; costs are USD.

CREATE TABLE IF NOT EXISTS vessels (
  mmsi        INTEGER PRIMARY KEY,
  name        TEXT,
  callsign    TEXT,
  destination TEXT,
  imo         INTEGER,
  ship_type   INTEGER,
  ais_class   TEXT NOT NULL DEFAULT 'B' CHECK (ais_class IN ('A', 'B')),
  length_m    REAL,
  width_m     REAL,
  flag_mid    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  mmsi       INTEGER NOT NULL REFERENCES vessels (mmsi),
  ts         INTEGER NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  sog        REAL,
  cog        REAL,
  heading    REAL,
  nav_status INTEGER
);
CREATE INDEX IF NOT EXISTS positions_mmsi_ts ON positions (mmsi, ts);
CREATE INDEX IF NOT EXISTS positions_ts ON positions (ts);

CREATE TABLE IF NOT EXISTS ingest_minutes (
  minute_ts INTEGER PRIMARY KEY,
  connected INTEGER NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS outages (
  id       INTEGER PRIMARY KEY,
  start_ts INTEGER NOT NULL,
  end_ts   INTEGER,
  cause    TEXT
);
CREATE INDEX IF NOT EXISTS outages_start ON outages (start_ts);

CREATE TABLE IF NOT EXISTS coverage (
  cell_id      INTEGER NOT NULL,
  hour_utc     INTEGER NOT NULL CHECK (hour_utc BETWEEN 0 AND 23),
  expected_min INTEGER NOT NULL,
  received_min INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  window_end   INTEGER NOT NULL,
  PRIMARY KEY (cell_id, hour_utc)
);

CREATE TABLE IF NOT EXISTS candidates (
  id               INTEGER PRIMARY KEY,
  mmsi             INTEGER NOT NULL REFERENCES vessels (mmsi),
  gap_start        INTEGER NOT NULL,
  gap_end          INTEGER,
  start_lat        REAL NOT NULL,
  start_lon        REAL NOT NULL,
  end_lat          REAL,
  end_lon          REAL,
  ais_class        TEXT NOT NULL CHECK (ais_class IN ('A', 'B')),
  nav_status_start INTEGER,
  state            TEXT NOT NULL CHECK (state IN ('detected', 'discarded', 'pending', 'investigating',
                     'investigated', 'error', 'pending_no_model', 'pending_budget')),
  discard_reason   TEXT CHECK (discard_reason IN ('own_outage', 'left_region', 'berth')),
  trigger_at       INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS candidates_state ON candidates (state);
CREATE INDEX IF NOT EXISTS candidates_mmsi_start ON candidates (mmsi, gap_start);

CREATE TABLE IF NOT EXISTS dossiers (
  id            INTEGER PRIMARY KEY,
  candidate_id  INTEGER NOT NULL REFERENCES candidates (id),
  version       INTEGER NOT NULL,
  verdict       TEXT NOT NULL CHECK (verdict IN ('coverage_gap', 'likely_dark', 'inconclusive')),
  confidence    TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  explanation   TEXT NOT NULL,
  profile       TEXT NOT NULL CHECK (profile IN ('local', 'haiku', 'sonnet')),
  escalated     INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd      REAL NOT NULL,
  duration_ms   INTEGER NOT NULL,
  agent_version TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (candidate_id, version)
);

CREATE TABLE IF NOT EXISTS trace_steps (
  dossier_id     INTEGER NOT NULL REFERENCES dossiers (id),
  idx            INTEGER NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('model_call', 'tool_call', 'nudge', 'error')),
  tool           TEXT,
  input_json     TEXT NOT NULL,
  output_summary TEXT NOT NULL,
  output_json    TEXT,
  model          TEXT,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  duration_ms    INTEGER NOT NULL,
  ts             INTEGER NOT NULL,
  PRIMARY KEY (dossier_id, idx)
);

CREATE TABLE IF NOT EXISTS evidence (
  dossier_id INTEGER NOT NULL,
  step_idx   INTEGER NOT NULL,
  claim      TEXT NOT NULL,
  FOREIGN KEY (dossier_id, step_idx) REFERENCES trace_steps (dossier_id, idx)
);
CREATE INDEX IF NOT EXISTS evidence_dossier ON evidence (dossier_id);

-- Written only by a human through the labeling view; no code path inserts labels on its own.
CREATE TABLE IF NOT EXISTS labels (
  candidate_id INTEGER PRIMARY KEY REFERENCES candidates (id),
  value        TEXT NOT NULL CHECK (value IN ('coverage_gap', 'likely_dark', 'undeterminable')),
  note         TEXT,
  author       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS eval_reports (
  id                INTEGER PRIMARY KEY,
  created_at        INTEGER NOT NULL,
  agent_version     TEXT NOT NULL,
  profile           TEXT,
  n_labeled         INTEGER NOT NULL,
  n_positive        INTEGER NOT NULL,
  n_undeterminable  INTEGER NOT NULL,
  stopping_rule_met INTEGER NOT NULL,
  metrics_json      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS briefs (
  date            TEXT PRIMARY KEY,
  sections_json   TEXT NOT NULL,
  narrative       TEXT,
  narrative_state TEXT NOT NULL CHECK (narrative_state IN ('pending', 'done', 'skipped')),
  generated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS budget (
  month     TEXT PRIMARY KEY,
  spent_usd REAL NOT NULL DEFAULT 0,
  cap_usd   REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recordings (
  id       INTEGER PRIMARY KEY,
  start_ts INTEGER NOT NULL,
  end_ts   INTEGER NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('raw_archive', 'demo', 'eval')),
  path     TEXT NOT NULL
);

-- Small process state that must survive restarts (e.g. up to where health minutes are closed).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
