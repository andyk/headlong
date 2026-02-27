-- Migration: Add agent/environment schema changes
-- Run this in Supabase SQL Editor

-- 1a. Update agents table: add id (UUID PK), system_prompt, config
-- Note: agents table already exists with 'name' as implicit PK.
-- We add an id column and new columns.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt TEXT DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- Make id a primary key if not already set
-- (agents table uses 'name' as the primary key currently, keep name UNIQUE)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_id_key'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_id_key UNIQUE (id);
  END IF;
END $$;

-- 1b. Create environments table
CREATE TABLE IF NOT EXISTS environments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  system_prompt TEXT DEFAULT '',
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 1c. Add FK on thoughts.agent_name -> agents.name
-- First ensure all agent_name values exist in agents table
INSERT INTO agents (name)
SELECT DISTINCT agent_name FROM thoughts
WHERE agent_name NOT IN (SELECT name FROM agents)
ON CONFLICT (name) DO NOTHING;

-- Add FK constraint (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'thoughts_agent_name_fkey'
  ) THEN
    ALTER TABLE thoughts
    ADD CONSTRAINT thoughts_agent_name_fkey
    FOREIGN KEY (agent_name) REFERENCES agents(name);
  END IF;
END $$;

-- 1d. Seed system prompts
UPDATE agents SET system_prompt =
'You are going to do some thinking on your own. Try to be conscious of your own thoughts so you can tell them to me one by one. Observations are injected into your stream of thoughts from the outside world so you should never come up with a thought that starts with ''observation:'''
WHERE name = 'Bobby Wilder';

INSERT INTO environments (name, system_prompt) VALUES (
'Bobby Wilder',
'Your job is to consider your recent thoughts and then take an action.
The way you take action is by calling one of the available tools with appropriate arguments.
If you don''t think any tool is appropriate for this action, respond with text starting with "observation: " explaining what you observe or that you don''t know how to do that.
When deciding what action to take, use the following stream of recent thoughts for context.'
) ON CONFLICT (name) DO UPDATE SET system_prompt = EXCLUDED.system_prompt;

-- Enable realtime for environments table
ALTER PUBLICATION supabase_realtime ADD TABLE environments;
