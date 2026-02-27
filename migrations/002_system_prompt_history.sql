-- Migration: System prompt history table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS system_prompt_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_table TEXT NOT NULL,  -- 'agents' or 'environments'
  source_name TEXT NOT NULL,   -- agent/environment name
  system_prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for efficient lookups by source
CREATE INDEX IF NOT EXISTS idx_sph_source ON system_prompt_history (source_table, source_name, created_at DESC);
