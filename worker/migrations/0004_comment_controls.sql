-- Edit, delete and like your own / any comment. Apply with:
--   npx wrangler d1 migrations apply mayobe-engage --remote
-- manage_hash: SHA-256 of the secret token the commenter's browser keeps (the token itself is never stored). NULL on older comments, which cannot be edited or deleted by their author.
ALTER TABLE comments ADD COLUMN manage_hash TEXT;
-- Time of the last edit (ms). NULL = never edited.
ALTER TABLE comments ADD COLUMN edited_at INTEGER;
-- The text before the last edit, for the moderator only. Never public.
ALTER TABLE comments ADD COLUMN prev_body TEXT;
-- Number of likes, kept in step with comment_likes.
ALTER TABLE comments ADD COLUMN likes INTEGER NOT NULL DEFAULT 0;

-- One row per visitor (voter = the visitor id, cid) per comment: a second like by the same visitor is a no-op.
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id INTEGER NOT NULL,
  voter      TEXT NOT NULL,
  created    INTEGER NOT NULL,
  PRIMARY KEY (comment_id, voter)
);
CREATE INDEX IF NOT EXISTS idx_comment_likes_voter ON comment_likes (voter);
