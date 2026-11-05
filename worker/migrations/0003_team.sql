-- 1 = written by the site team through the admin API (shows a Team badge). Apply with:
--   npx wrangler d1 migrations apply mayobe-engage --remote
ALTER TABLE comments ADD COLUMN team INTEGER NOT NULL DEFAULT 0;
