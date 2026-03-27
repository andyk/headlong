# Headlong Setup Guide

Follow these steps in order to get your own Headlong instance running.

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- [psql](https://www.postgresql.org/docs/current/app-psql.html) (`brew install libpq && export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`)
- A [Supabase](https://supabase.com) project
- An [Anthropic](https://console.anthropic.com) API key

---

## Step 1: Configure `.env`

Copy the example and fill in your values:

```bash
cp .env.example .env
```

See `.env.example` for where to find each value. The required ones are:

- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `SUPABASE_URL_HEADLONG` — your Supabase project URL
- `SUPABASE_ANON_KEY_HEADLONG` — from Supabase → Project Settings → API
- `SUPABASE_SERVICE_ROLE_KEY_HEADLONG` — from Supabase → Project Settings → API
- `SUPABASE_ID_HEADLONG` — your project ref (the part before `.supabase.co`)
- `SUPABASE_DB_URL` — session pooler connection string (see below)
- `OPENAI_API_KEY` — required for thought embeddings (every thought is embedded with `text-embedding-3-small` for vector search)

**Finding your `SUPABASE_DB_URL`:**

Go to Supabase → Project Settings → Database → Connection Pooling.
Copy the **Session mode** URI (port 5432). It looks like:
```
postgresql://postgres.<ref>:[db-password]@aws-0-<region>.pooler.supabase.com:5432/postgres
```

> Note: The direct `db.<ref>.supabase.co` host is disabled on newer Supabase projects.
> Use the pooler URL. Make sure it's port **5432** (session mode), not 6543 (transaction mode).

Leave `AGENT_REPL_DB_URL` blank for now — you'll fill it in after Step 2.

---

## Step 2: Run Migrations

Choose a strong password for the `agent_repl` database role, then run:

```bash
export AGENT_REPL_PASSWORD=your-strong-password-here
./scripts/run_migrations.sh
```

This runs all migrations in `migrations/` in order. Expected output is `OK` for each.
NOTICEs about "ivfflat index created with little data" are normal on a fresh database.

After it completes, fill in `AGENT_REPL_DB_URL` in your `.env`:
```
AGENT_REPL_DB_URL=postgresql://agent_repl.<ref>:<AGENT_REPL_PASSWORD>@<your-pooler-host>:5432/postgres
```
(Same host as `SUPABASE_DB_URL`, just swap the username to `agent_repl.<ref>` and the password.)

---

## Step 3: Install Python Dependencies

**Env daemon:**
```bash
cd packages/env
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

**Agent daemon:**
```bash
cd packages/agent
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

## Step 4: Install Node Dependencies

```bash
cd packages/webapp
npm install
```

---

## Step 5: Create Your Agent

In the Supabase SQL Editor, insert an agent record:

```sql
INSERT INTO agents (name, system_prompt, config) VALUES (
  'My Agent',
  NULL,        -- NULL uses the default RLM system prompt
  '{}'::jsonb
);
```

Replace `'My Agent'` with whatever name you want. See
`migrations/007_dev_prototype_agent.sql` for an example with a custom system prompt.

---

## Step 6: Start Everything

```bash
./headlong start "My Agent"
```

Or manually in 3 separate terminals:

```bash
# Terminal 1 — env daemon
cd packages/env && source venv/bin/activate && python main.py "My Agent"

# Terminal 2 — agent daemon
cd packages/agent && source venv/bin/activate && python main.py "My Agent"

# Terminal 3 — webapp
cd packages/webapp && npm run dev
```

Then open: http://localhost:5173

---

## Step 7: Test It

Type a message in the editor and press Enter. The agent should respond within a few seconds.
Thoughts appear in the stream in real time.

---

## Telegram Setup (optional)

Telegram lets the agent send and receive messages. To enable it:

1. Message **@BotFather** on Telegram → `/newbot` → follow prompts → copy the token into `TELEGRAM_BOT_TOKEN`
2. Find your personal user ID by messaging **@userinfobot** — it replies instantly with your ID. Set this as `TELEGRAM_CHAT_ID`. This is **your** user ID, not the bot's.
3. Send `/start` to your bot in Telegram. This is required before the bot is allowed to message you — without it you'll get a "Forbidden: bots can't initiate conversations" error.

---

## Troubleshooting

- **`relation "agents" does not exist`** — Run migrations starting from `000_initial_schema.sql`
- **DB connection errors** — Use the session pooler URL (port 5432). The direct `db.<ref>.supabase.co` host is not available on newer projects.
- **`agent_repl` login fails** — Verify the password in `AGENT_REPL_DB_URL` matches what you passed as `AGENT_REPL_PASSWORD` when running migrations
- **Agent not responding** — Check agent daemon logs: `./headlong logs agent`
- **Realtime not working** — Supabase → Database → Replication → confirm `thoughts` and `agents` are in the `supabase_realtime` publication
