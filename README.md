# Headlong

Headlong is a framework for creating AI agents that think in a persistent stream of consciousness. Humans and agents co-edit a shared thought stream using a ProseMirror editor, with an environment daemon that gives agents the ability to act in the world (browse the web, send messages, write code, etc.).

## Architecture

Headlong has three processes:

- **Webapp** (`packages/webapp`) — Vite/React frontend with a ProseMirror editor for viewing and editing the thought stream. Communicates via Supabase Realtime.
- **Agent daemon** (`packages/agent`) — Generates thoughts using an LLM (Claude) with a Python REPL for reasoning. Runs on port 8001.
- **Env daemon** (`packages/env`) — Handles `action:` thoughts by calling tools (web search, Telegram, terminal, Claude Code, etc.) via Claude tool-calling. Serves the thought streaming API on port 8000.

All three share a Supabase `thoughts` table and use Supabase Realtime for coordination.

## Prerequisites

### Supabase

You need a [Supabase](https://supabase.com) project. Run the migrations in `migrations/` in order via the Supabase SQL Editor:

```
migrations/001_agent_env_schema.sql
migrations/002_system_prompt_history.sql
migrations/003_memories_table.sql
migrations/004_thought_embeddings.sql
migrations/005_thought_created_by.sql
```

### Environment variables

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL_HEADLONG=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY_HEADLONG=eyJ...
SUPABASE_ANON_KEY_HEADLONG=eyJ...
OPENAI_API_KEY=sk-...              # for embeddings (text-embedding-3-small)
SERPAPI_API_KEY=...                 # for web search tool
TELEGRAM_BOT_TOKEN=...             # optional, for Telegram messaging
TELEGRAM_CHAT_ID=...               # optional, for Telegram messaging
```

The agent daemon also needs a direct Postgres connection for the REPL's `sql()` function. Set this in your `.env`:

```
SUPABASE_DB_URL_HEADLONG=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

## Install via Claude Code, Codex, etc.

If you have an AI coding agent like [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or Codex, you can paste the following prompt to have it set up Headlong for you:

> Clone https://github.com/bobbywilder/headlong and follow the README to set it up. I have already created a Supabase project and run the migrations. My Supabase credentials and API keys are in my `.env` file at the project root. Set up the Python virtual environments, install dependencies (including Playwright), and install the webapp's npm packages.

**Before running this, you must:**
1. Create a [Supabase](https://supabase.com) project
2. Run the SQL migrations in `migrations/` via the Supabase SQL Editor (see Prerequisites above)
3. Create a `.env` file with your credentials (see Environment variables above)

## Setup on macOS

### System dependencies

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# tmux is required by the env daemon's terminal tool
brew install tmux

# Python 3.10+ is required
brew install python@3.10   # or python@3.11, python@3.12

# Node.js is required for the webapp (and Claude Code if running natively)
brew install node
```

### Python virtual environments

Each Python package needs its own venv:

```bash
# Env daemon
cd packages/env
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate

# Agent daemon
cd ../agent
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
```

### Playwright (env daemon)

The env daemon uses Playwright for the `visitURL` tool. Install the browser binary:

```bash
cd packages/env
source venv/bin/activate
playwright install chromium
```

If you get errors about missing system libraries, run:

```bash
playwright install --with-deps chromium
```

### Claude Code (optional, env daemon)

If you want the agent to delegate coding tasks to Claude Code:

```bash
npm install -g @anthropic-ai/claude-code
```

### Webapp dependencies

```bash
cd packages/webapp
npm install
```

## Running Headlong

### Quick start with the `headlong` CLI

The `headlong` script in the project root manages all three services:

```bash
# Start everything (agent name must match a row in your Supabase `agents` table)
./headlong start "Bobby Wilder"

# Check status
./headlong status

# Tail logs
./headlong logs           # all services
./headlong logs env       # just the env daemon
./headlong logs agent     # just the agent daemon

# Stop everything
./headlong stop

# Restart a single service
./headlong stop env
./headlong start env
```

By default, the CLI runs the env daemon in Docker if Docker is available, or natively if not. To force native mode:

```bash
./headlong start "Bobby Wilder" --no-docker
```

### Running services manually

If you prefer to run each service in its own terminal:

**Terminal 1 — Env daemon:**
```bash
cd packages/env
source venv/bin/activate
python main.py "Bobby Wilder"
```

**Terminal 2 — Agent daemon:**
```bash
cd packages/agent
source venv/bin/activate
python main.py "Bobby Wilder"
```

**Terminal 3 — Webapp:**
```bash
cd packages/webapp
npm run dev
```

The webapp will be at http://localhost:5173. Select your agent from the dropdown.

## Running the env daemon in Docker (optional)

Docker is useful for sandboxing the env daemon (the agent can run terminal commands, write files, etc.). It is **not required** — you can run everything natively on macOS.

### Build and run manually

```bash
# From the repo root
docker build -t headlong-env packages/env/
docker run -d \
  --name headlong-env \
  --env-file .env \
  -p 8000:8000 \
  -v "$(pwd)":/app/headlong \
  headlong-env \
  "Bobby Wilder"
```

### Or use the helper script

```bash
packages/env/run_in_docker.sh "Bobby Wilder"
```

### View container logs

```bash
docker logs -f headlong-env
```

The Docker image includes tmux, Node.js, Claude Code CLI, and Playwright with Chromium. It runs as a non-root user (`headlong`) because Claude Code requires this.

## Project structure

```
headlong
├── headlong                  # CLI to start/stop/status all services
├── .env                      # Environment variables (not committed)
├── migrations/               # Supabase SQL migrations (run manually)
├── packages/
│   ├── agent/                # Agent daemon (Python, port 8001)
│   │   ├── main.py           # Entry point
│   │   ├── thought_api.py    # FastAPI server for thought generation
│   │   ├── llm.py            # LLM integration (Claude)
│   │   ├── repl.py           # Sandboxed Python REPL for agent reasoning
│   │   └── supabase_client.py
│   ├── env/                  # Environment daemon (Python, port 8000)
│   │   ├── main.py           # Entry point, Realtime subscription, heartbeat
│   │   ├── thought_api.py    # FastAPI server for streaming API
│   │   ├── llm.py            # Claude tool-calling for action handling
│   │   ├── supabase_client.py
│   │   ├── Dockerfile        # Docker image definition
│   │   └── tools/            # Tool implementations
│   │       ├── __init__.py   # Tool registry
│   │       ├── web.py        # searchGoogle, visitURL
│   │       ├── terminal.py   # tmux-based terminal tools
│   │       └── telegram.py   # sendMessage + listener
│   └── webapp/               # Web frontend (Vite + React + TypeScript)
│       ├── src/App.tsx        # Main app with ProseMirror editor
│       └── package.json
└── generate-supabase-typescript-types.sh
```

## How it works

1. The **agent daemon** generates thoughts by calling Claude with the recent thought history and a Python REPL. Claude reasons through code execution, then outputs a final thought via `FINAL()`.

2. When a thought starts with `action:`, the agent sets `metadata.needs_handling = true`.

3. The **env daemon** subscribes to the `thoughts` table via Supabase Realtime. When it sees an action thought with `needs_handling`, it calls Claude with the available tools to decide which tool to invoke, executes it, and inserts the result as an `observation:` thought.

4. The **webapp** renders the thought stream in a ProseMirror editor. Users can read, edit, and add thoughts. Pressing Option+Enter on an `action:` thought triggers the env daemon to handle it.

5. Each thought tracks `created_by` (`user`, `agent`, or `env`) and is embedded with OpenAI's `text-embedding-3-small` for vector search.
