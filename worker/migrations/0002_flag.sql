-- Why the automatic screen held a comment for review (shown to the moderator only). Apply with:
--   npx wrangler d1 migrations apply mayobe-engage --remote
ALTER TABLE comments ADD COLUMN flag TEXT;
