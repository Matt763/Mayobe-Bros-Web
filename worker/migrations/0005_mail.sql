-- Email through Resend: daily send budget, suppression list, emailed manage links, and the "email me replies" choice. Apply with:
--   npx wrangler d1 migrations apply mayobe-engage --remote
-- One row per UTC day and kind (owner, commenter, contact, news): how many messages were sent.
CREATE TABLE IF NOT EXISTS mail_budget (
  day  TEXT NOT NULL,
  kind TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
-- Addresses that must never be mailed (bounced, complained, unsubscribed). Always lowercase.
CREATE TABLE IF NOT EXISTS suppressed (
  email   TEXT PRIMARY KEY,
  reason  TEXT,
  created INTEGER
);
-- Emailed manage links: only the SHA-256 of the secret is stored.
CREATE TABLE IF NOT EXISTS manage_links (
  hash       TEXT PRIMARY KEY,
  comment_id INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  expires    INTEGER,
  created    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manage_links_comment ON manage_links (comment_id);
-- The commenter ticked "email me when someone replies" (wanted), and later opened the emailed link (confirmed).
ALTER TABLE comments ADD COLUMN notify_wanted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN notify_confirmed INTEGER NOT NULL DEFAULT 0;
