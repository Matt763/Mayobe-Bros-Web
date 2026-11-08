-- Two indexes the spam check and the newsletter clean-up were missing (both ran a full table scan). Safe to run twice. Apply with:
--   npx wrangler d1 migrations apply mayobe-engage --remote
CREATE INDEX IF NOT EXISTS idx_comments_ip_status ON comments (ip_hash, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_subscriber ON newsletter_deliveries (subscriber_id);
