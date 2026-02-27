-- Track who created each thought: 'user', 'agent', or 'env'
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS created_by text;

-- Backfill: infer from metadata where possible
-- Thoughts with metadata.last_updated_by matching known patterns could be backfilled,
-- but since instance IDs are random UUIDs, we leave existing rows as NULL.

COMMENT ON COLUMN thoughts.created_by IS 'Who created this thought: user, agent, or env';
