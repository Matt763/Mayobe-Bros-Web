-- Newsletter (Phase 3): subscribers, hashed one-time tokens, a per-article record and a per-(article, subscriber) delivery log.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,                 -- trimmed, lower case: where mail goes
  email_key TEXT NOT NULL UNIQUE,      -- canonicalEmail(email): one row per inbox
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','unsubscribed')),
  created INTEGER NOT NULL, confirmed INTEGER, unsubscribed INTEGER,
  farewell_sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_nl_status ON newsletter_subscribers (status, confirmed);
CREATE TABLE IF NOT EXISTS newsletter_tokens (
  hash TEXT PRIMARY KEY, subscriber_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('confirm','unsub')), expires INTEGER, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nl_tokens_sub ON newsletter_tokens (subscriber_id);
-- one row per article the cron knows: seeded = recorded without sending; sent_at NULL = still being sent
CREATE TABLE IF NOT EXISTS newsletter_sent (
  slug TEXT PRIMARY KEY, title TEXT, queued_at INTEGER NOT NULL, sent_at INTEGER, seeded INTEGER NOT NULL DEFAULT 0
);
-- claimed before the Resend call, so a retry or an overlapping run never sends twice
CREATE TABLE IF NOT EXISTS newsletter_deliveries (
  slug TEXT NOT NULL, subscriber_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed','sent','skipped','failed')), at INTEGER NOT NULL,
  PRIMARY KEY (slug, subscriber_id)
);
