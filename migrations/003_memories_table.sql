-- Migration: Memories table with pgvector for semantic search
-- Run this in Supabase SQL Editor

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create memories table
CREATE TABLE IF NOT EXISTS memories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL,
  body TEXT NOT NULL,
  embedding vector(1536),  -- text-embedding-3-small dimensions
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_name);

-- ivfflat index for fast vector similarity search
-- Note: requires at least some rows to exist before building;
-- if table is empty, Postgres will build a flat index and rebuild later.
CREATE INDEX IF NOT EXISTS idx_memories_embedding
  ON memories USING ivfflat (embedding vector_cosine_ops);

-- 3. Create restricted Postgres role for the agent REPL
-- The agent_repl role gets minimal privileges: read-only on thoughts/agents,
-- read-write on memories. This limits blast radius of arbitrary SQL in the REPL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_repl') THEN
    CREATE ROLE agent_repl LOGIN PASSWORD 'CHANGE_ME_BEFORE_RUNNING';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO agent_repl;

-- thoughts: read-only
GRANT SELECT ON thoughts TO agent_repl;

-- memories: read-write
GRANT SELECT, INSERT, UPDATE, DELETE ON memories TO agent_repl;

-- agents table: read-only (for config lookups)
GRANT SELECT ON agents TO agent_repl;

-- 4. RLS policies for agent_repl
-- Supabase enables RLS by default. The GRANT alone isn't enough — we need
-- explicit policies so agent_repl can read through RLS.
CREATE POLICY "agent_repl_read_thoughts"
  ON thoughts FOR SELECT TO agent_repl
  USING (true);

CREATE POLICY "agent_repl_read_agents"
  ON agents FOR SELECT TO agent_repl
  USING (true);
