-- Migration: Initial schema
-- Creates the base agents and thoughts tables that all other migrations depend on.
-- This schema predated the migration system and was reconstructed from database.types.ts.

-- agents table
CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable realtime for agents
ALTER PUBLICATION supabase_realtime ADD TABLE agents;

-- thoughts table
CREATE TABLE IF NOT EXISTS thoughts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  index FLOAT8 NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_thoughts_agent_name ON thoughts(agent_name);
CREATE INDEX IF NOT EXISTS idx_thoughts_index ON thoughts(index);

-- Enable realtime for thoughts
ALTER PUBLICATION supabase_realtime ADD TABLE thoughts;
