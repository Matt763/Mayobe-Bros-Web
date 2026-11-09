-- Which articles are read most (feeds the Popular page). Apply with:  npx wrangler d1 migrations apply mayobe-engage --remote
-- Safe to run twice. Nothing here can identify a person:
--   read_seen  one short code per (day, article, visitor) so a visitor is counted once a day. The code is a salted hash that changes
--              every day; the rows are deleted after two days (see purgeReads in src/reads.js).
--   post_reads the only thing kept: how many engaged reads an article had on a day (n), and how many of those arrived from /popular/ (n_pop,
--              counted at half weight so the Popular page cannot feed itself). Deleted after 60 days.
CREATE TABLE IF NOT EXISTS read_seen (
  day  TEXT NOT NULL,
  slug TEXT NOT NULL,
  vh   TEXT NOT NULL,
  PRIMARY KEY (day, slug, vh)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS post_reads (
  slug  TEXT NOT NULL,
  day   TEXT NOT NULL,
  n     INTEGER NOT NULL DEFAULT 0,
  n_pop INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
) WITHOUT ROWID;
