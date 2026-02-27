-- Migration: Replace old embedding(384) column with embedding(1536) for text-embedding-3-small
-- Run this after 003_memories_table.sql

-- 1. Drop the old 384-dim embedding column from a previous feature
ALTER TABLE thoughts DROP COLUMN IF EXISTS embedding;

-- 2. Add new 1536-dim embedding column (pgvector extension already enabled in 003)
ALTER TABLE thoughts ADD COLUMN embedding vector(1536);

-- 3. ivfflat index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_thoughts_embedding
  ON thoughts USING ivfflat (embedding vector_cosine_ops);

-- 4. Grant agent_repl role UPDATE on embedding column
-- (agent_repl already has SELECT on thoughts from 003)
GRANT UPDATE (embedding) ON thoughts TO agent_repl;
