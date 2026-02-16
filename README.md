Headlong is a framework for human users to create and curate high quality chain-of-thought datasets and use them in AI Agents.

The webapp frontend is in `packages/webapp` - it's a vite Typescript project.

The environment daemon is in `packages/env` - a Python process that runs the agent loop (Claude + tools) and serves the thought streaming API. It uses tmux for terminal management and Claude for LLM reasoning with native tool use.

The webapp communicates with the environment via a Supabase `thoughts` table and Supabase's realtime system.


## Install and run

### 1. Set up environment variables

Copy or edit `.env` in the project root. Required keys:
```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL_HEADLONG=...
SUPABASE_SERVICE_ROLE_KEY_HEADLONG=...
SERPAPI_API_KEY=...
TELEGRAM_BOT_TOKEN=...      # optional, for messaging
TELEGRAM_CHAT_ID=...         # optional, for messaging
```

### 2. Start the env daemon (Python)

```bash
cd packages/env
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py <agentName>
```

This starts the agent loop and the thought streaming API on port 8000.

**Requires:** tmux installed (`brew install tmux` on macOS).

### 3. Start the webapp

```bash
# in a new terminal
cd packages/webapp
npm install
npm run dev
```

The webapp runs on http://localhost:5173.
