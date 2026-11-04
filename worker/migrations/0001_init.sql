-- Mayobe Bros comments + reactions. Apply with:  npx wrangler d1 migrations apply mayobe-engage --remote
CREATE TABLE IF NOT EXISTS posts (
  slug    TEXT PRIMARY KEY,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_stats (
  slug      TEXT PRIMARY KEY,
  comments  INTEGER NOT NULL DEFAULT 0,
  r_like    INTEGER NOT NULL DEFAULT 0,
  r_amazed  INTEGER NOT NULL DEFAULT 0,
  r_sad     INTEGER NOT NULL DEFAULT 0,
  r_angry   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL,
  parent_id INTEGER,
  name      TEXT NOT NULL,
  email     TEXT,
  body      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | spam
  created   INTEGER NOT NULL,
  ip_hash   TEXT,
  cid       TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_slug   ON comments (slug, status, created);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, created);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_cid    ON comments (cid, status);

CREATE TABLE IF NOT EXISTS reactions (
  slug    TEXT NOT NULL,
  cid     TEXT NOT NULL,
  type    TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (slug, cid)
);

CREATE TABLE IF NOT EXISTS hits (
  k       TEXT PRIMARY KEY,
  n       INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hits_expires ON hits (expires);
