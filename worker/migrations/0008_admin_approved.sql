-- Marks a comment that a person on the team approved by hand after the automatic screen held it (from the email button, the
-- owner CLI or the admin API). Public: the page shows a small "Approved by Admin Mayobe Bros" line and a green double check.
-- NULL = published by the automatic screen, or never approved by hand. Apply with:
--   npx wrangler d1 migrations apply mayobe-engage --remote
ALTER TABLE comments ADD COLUMN approved_by TEXT;
ALTER TABLE comments ADD COLUMN approved_at INTEGER;
