-- Migration: Inter-agent chat messages
-- Run this in Supabase SQL Editor

-- 1. Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_chat_messages_to_agent ON chat_messages (to_agent);
CREATE INDEX IF NOT EXISTS idx_chat_messages_from_agent ON chat_messages (from_agent);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages (created_at);

-- 3. Enable Supabase Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- 4. Grant SELECT to agent_repl role (read-only for agent REPL)
GRANT SELECT ON chat_messages TO agent_repl;

-- 5. RLS policy: allow service role full access
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on chat_messages"
  ON chat_messages
  FOR ALL
  USING (true)
  WITH CHECK (true);
