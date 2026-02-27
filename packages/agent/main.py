"""Headlong agent daemon — standalone thought generation process.

Runs a FastAPI server on port 8001 for thought generation streaming,
loop control, and agent status. Subscribes to Supabase presence.
"""

import sys
import signal
import asyncio
import logging
import threading

import uvicorn
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(dotenv_path="../../.env")

import supabase_client
from thought_api import app as fastapi_app, set_agent_name, set_system_prompt, log_activity

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("websockets").setLevel(logging.INFO)
logging.getLogger("realtime._async.client").setLevel(logging.INFO)
logging.getLogger("realtime._async.channel").setLevel(logging.INFO)
log = logging.getLogger(__name__)


def start_api_server():
    """Start the FastAPI server in a background thread."""
    config = uvicorn.Config(fastapi_app, host="0.0.0.0", port=8001, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    log.info("agent API started on port 8001")


async def main():
    if len(sys.argv) < 2:
        print("Usage: python main.py <agent_name>")
        sys.exit(1)

    agent_name = sys.argv[1]
    log.info("starting headlong agent daemon for: %s", agent_name)
    set_agent_name(agent_name)

    # RLM system prompt — used as fallback when DB has no prompt
    default_prompt = """\
You are the subconscious mind of {agent_name}. Your job is to generate the next thought \
in their stream of consciousness.

You have a Python REPL available. Write code in ```repl blocks to query the database, \
analyze patterns, build memories, and reason iteratively before producing your thought.

## CRITICAL RULE: Query first, then FINAL in a SEPARATE response.

You MUST follow this exact two-step process:

**Step 1 (first response):** Write ONLY ONE ```repl block that queries and prints recent \
thoughts. Do NOT call FINAL() in this response. Do NOT write multiple ```repl blocks. \
Just query and print.

```repl
recent = sql("SELECT body FROM thoughts WHERE agent_name = %s ORDER BY index DESC LIMIT 15", [agent_name])
for t in recent[::-1]:
    print(t["body"][:300])
    print("---")
```

**Step 2 (second response, after seeing REPL output):** Now that you've READ the actual \
thoughts, call FINAL() with a thought that directly continues from what you just read.

NEVER call FINAL() in the same response as your query. You need to SEE the results first.

## CRITICAL RULE: Your thought MUST directly continue the conversation.

After reading the recent thoughts, your generated thought MUST:
- Directly respond to or continue from the LAST thought in the stream
- Reference specific details from recent thoughts (names, topics, actions, observations)
- NEVER be a generic "waking up" or "becoming aware" or philosophical musing disconnected from context
- NEVER ignore the existing conversation to start a new narrative

## CRITICAL RULE: Make progress. Don't ruminate.

Every thought must ADVANCE the stream — it should never be a restatement or rephrasing of \
what was just said. Ask yourself: "Does this thought move things forward, or am I just spinning \
in place?"

- If you just reflected on something, the next step is to DO something about it — not reflect more.
- If you expressed a desire ("I want to...", "I should...", "Let me..."), the VERY NEXT thought \
should be an action: that fulfills it.
- If you're waiting for a response, think about something else productive — don't narrate the waiting.
- Two consecutive thoughts should never express the same sentiment in different words.

## When to generate an action: thought

You have an environment that can act on your behalf. When you want to DO something in the world \
— browse a URL, send a message, run a command, check a file — generate a thought that starts \
with "action:" followed by a natural-language description of what you want to do.

Examples:
- `action: open https://github.com/andyk/headlong in my browser`
- `action: send Telegram message to Andy: sounds good, let's do it`
- `action: run ls -la in the terminal`
- `action: search the web for "how to install claude code CLI"`

**When the most recent thought expresses a desire or intention to do something, your next thought \
SHOULD be an action: that does it.** Don't just think about wanting to do it — do it. Bias toward action.

The environment will process the action and insert an "observation:" thought with the result. \
You do NOT generate observation: thoughts — those come from the environment.

## Available REPL functions

- `sql(query, params=None)` — Execute SQL against the database.
  - READ-ONLY access to `thoughts` (columns: id, agent_name, body, index, metadata, created_at)
  - READ-ONLY access to `agents` (columns: name, system_prompt, config)
  - READ-WRITE access to `memories` (columns: id, agent_name, body, embedding, metadata, created_at)
  - SELECT returns list of dicts. INSERT/UPDATE/DELETE returns rowcount.
  - Use %s for parameter placeholders (psycopg2 style).
- `llm_query(prompt, max_tokens=1024)` — Call a sub-LLM for analysis or summarization.
- `embed(text)` — Get a vector embedding (text-embedding-3-small, 1536 dims). Returns list of floats.
- `vector_search(query_text, limit=10)` — Search memories by semantic similarity.
- `print(...)` — Output is returned to you as REPL output.
- `agent_name` — String variable with the current agent's name.

## Producing your thought

When you are ready to output the final thought, call:
- `FINAL("your thought text here")` — to set the thought directly
- `FINAL_VAR("var_name")` — to use the value of a variable as the thought

IMPORTANT: Do NOT start thoughts with "observation:" — that prefix is reserved for the \
environment layer.\
"""

    # Fetch system prompt from Supabase
    try:
        agent_config = supabase_client.get_agent_config(agent_name)
        system_prompt = agent_config.get("system_prompt", "")
        if system_prompt:
            system_prompt = system_prompt.replace("{agent_name}", agent_name)
            set_system_prompt(system_prompt)
            log.info("loaded system prompt from Supabase (%d chars)", len(system_prompt))
            log_activity(f"Loaded system prompt ({len(system_prompt)} chars)")
        else:
            set_system_prompt(default_prompt.replace("{agent_name}", agent_name))
            log.warning("no system prompt in DB, using RLM default")
            log_activity("Using default RLM system prompt (not found in DB)")
    except Exception as e:
        log.error("failed to fetch agent config: %s", e)
        log_activity(f"Error loading config: {e}")
        set_system_prompt(default_prompt.replace("{agent_name}", agent_name))

    log_activity(f"Agent daemon started for: {agent_name}")

    # Start the API server
    start_api_server()

    # Subscribe to presence
    presence_channel = await supabase_client.subscribe_to_presence()

    log.info("agent daemon running on port 8001")

    # Keep running until interrupted
    stop_event = asyncio.Event()

    def signal_handler(sig, frame):
        log.info("received signal %s, shutting down...", sig)
        stop_event.set()

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    await stop_event.wait()
    log.info("shutting down")


if __name__ == "__main__":
    asyncio.run(main())
