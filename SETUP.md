# Headlong Setup Guide

Follow these steps in order to get your own Headlong instance running.

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- tmux (`brew install tmux`)
- [psql](https://www.postgresql.org/docs/current/app-psql.html) (`brew install libpq && export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`)
- A [Supabase](https://supabase.com) project

---

## Step 1: Configure base `.env`

Copy the example and fill in your Supabase values:

```bash
cp .env.example .env
```

The base `.env` only needs **Supabase credentials** — per-agent credentials
(Anthropic, OpenAI, Telegram) are handled in Step 4 by `./headlong create`.

Required values:

- `SUPABASE_URL_HEADLONG` — your project URL (`https://<ref>.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY_HEADLONG` — from Supabase → Project Settings → API
- `SUPABASE_ANON_KEY_HEADLONG` — from Supabase → Project Settings → API
- `SUPABASE_ID_HEADLONG` — just the project ref (e.g. `abcdefghij`)
- `SUPABASE_DB_URL` — session pooler connection string (see below)

**Finding `SUPABASE_DB_URL`:**

Go to Supabase → Project Settings → Database → Connection Pooling.
Copy the **Session mode** URI (port 5432):
```
postgresql://postgres.<ref>:[db-password]@aws-0-<region>.pooler.supabase.com:5432/postgres
```

> Note: The direct `db.<ref>.supabase.co` host is disabled on newer Supabase projects.
> Use the pooler URL at port **5432** (session mode), not 6543 (transaction mode).

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
(Same host as `SUPABASE_DB_URL`, swap the username to `agent_repl.<ref>` and use the password you just set.)

---

## Step 3: Install Dependencies

**Env daemon:**
```bash
cd packages/env
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

> If you get SSL certificate errors on macOS (Python 3.13+), run:
> `/Applications/Python\ 3.13/Install\ Certificates.command`

**Agent daemon:**
```bash
cd packages/agent
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Webapp:**
```bash
cd packages/webapp
npm install
```

---

## Step 4: Create Your Agent

The `./headlong create` command sets up everything for a new agent — creates the
database rows, config directory, and prompts for per-agent credentials:

```bash
./headlong create "My Agent"
```

It will interactively prompt for:
- **Anthropic API key** — from [console.anthropic.com](https://console.anthropic.com)
- **OpenAI API key** — from [platform.openai.com](https://platform.openai.com/api-keys) (used for thought embeddings)
- **Telegram bot token** — create a bot via @BotFather on Telegram → `/newbot`
- **Telegram chat ID** — your personal Telegram user ID (find it by messaging @userinfobot)

These are saved to `.headlong/<agent-slug>/.env`, not the base `.env`.

You can also pass credentials as flags for non-interactive use:
```bash
./headlong create "My Agent" \
  --anthropic-key sk-ant-... \
  --openai-key sk-... \
  --telegram-token 123:AAH... \
  --telegram-chat-id 123456789
```

**Telegram note:** After setting up your bot, send `/start` to it in Telegram.
This is required before the bot can message you — without it you'll get
"Forbidden: bots can't initiate conversations".

---

## Step 5: Start Everything

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

## Step 6: Test It

Type a message in the editor and press Enter. The agent should respond within a
few seconds. Thoughts appear in the stream in real time.

---

## Troubleshooting

- **`relation "agents" does not exist`** — Make sure migrations ran from `000_initial_schema.sql` onwards
- **DB connection errors** — Use the session pooler URL (port 5432). The direct `db.<ref>.supabase.co` host is not available on newer projects.
- **`agent_repl` login fails** — Verify the password in `AGENT_REPL_DB_URL` matches `AGENT_REPL_PASSWORD` used during migration
- **SSL certificate errors on macOS** — Run `/Applications/Python\ 3.X/Install\ Certificates.command`
- **Agent not responding** — Check logs: `./headlong logs agent`
- **Telegram "Forbidden: bots can't initiate conversations"** — Send `/start` to your bot in Telegram first
- **Telegram messages going to wrong person** — `TELEGRAM_CHAT_ID` should be your user ID (find via @userinfobot), not the bot's ID
- **Realtime not working** — Supabase → Database → Replication → confirm `thoughts` and `agents` are in the `supabase_realtime` publication
