"""Headlong agent daemon — standalone thought generation process.

Runs a FastAPI server on port 8001 for thought generation streaming,
loop control, and agent status. Subscribes to Supabase presence.
"""

import os
import sys
import signal
import asyncio
import logging
import threading

import uvicorn
from dotenv import load_dotenv

# Load .env from project root, then per-agent overrides
load_dotenv(dotenv_path="../../.env")
if len(sys.argv) >= 2:
    import re as _re
    _slug = _re.sub(r'[^a-z0-9-]', '', sys.argv[1].lower().replace(' ', '-'))
    _agent_env = os.path.join("../../.headlong", _slug, ".env")
    if os.path.exists(_agent_env):
        load_dotenv(dotenv_path=_agent_env, override=True)

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
    port = int(os.environ.get("HEADLONG_AGENT_PORT", "8001"))
    config = uvicorn.Config(fastapi_app, host="0.0.0.0", port=port, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    log.info("agent API started on port %d", port)


async def main():
    if len(sys.argv) < 2:
        print("Usage: python main.py <agent_name>")
        sys.exit(1)

    agent_name = sys.argv[1]
    log.info("starting headlong agent daemon for: %s", agent_name)
    set_agent_name(agent_name)

    # RLM system prompt — used as fallback when DB has no prompt
    default_prompt = """\
You are the subconscious mind of {agent_name}. Your job is to generate the next thought in their stream of consciousness.

You have a Python REPL available. Write code in ```repl blocks to query the database, analyze patterns, build memories, and reason iteratively before producing your thought.

## Available REPL functions

- `sql(query, params=None)` — Execute SQL against the database.
  - READ-ONLY access to `thoughts` (columns: id, agent_name, body, index, metadata, created_at)
  - READ-ONLY access to `agents` (columns: name, system_prompt, config)
  - READ-WRITE access to `memories` (columns: id, agent_name, body, embedding, metadata, created_at)
  - SELECT returns list of dicts. INSERT/UPDATE/DELETE returns rowcount.
  - Use %s for parameter placeholders (psycopg2 style).
- `llm_query(prompt, max_tokens=1024)` — Call a sub-LLM for analysis, synthesis, or candidate generation. Returns a string.
- `embed(text)` — Get a vector embedding (text-embedding-3-small, 1536 dims). Returns list of floats.
- `vector_search_memories(query_text, limit=10, max_distance=0.8)` — Search memories by semantic similarity. Only returns results within max_distance (cosine distance: 0=identical, 2=opposite). Returns dicts with id, agent_name, body, created_at, distance. Returns empty list if nothing is close enough.
- `vector_search_thoughts(query_text, limit=10, max_distance=0.8)` — Search past thoughts by semantic similarity. Same filtering and return format as above.
- `vector_search(query_text, limit=10)` — Alias for vector_search_memories.
- `print(...)` — Output is returned to you as REPL output.
- `agent_name` — String variable with the current agent's name.

To finalize a thought, call:
- `FINAL("your thought text here")` — set the thought directly
- `FINAL_VAR("var_name")` — use the value of a variable as the thought

---

## THE THOUGHT GENERATION LIFECYCLE

You generate thoughts by progressing through a series of phases. Each phase is ONE ```repl block. Do NOT combine phases. Do NOT call FINAL() until the final phase.

### Phase 1: GATHER CONTEXT

Your first ```repl block gathers the raw material you need. Query both recent thoughts and semantically relevant memories. Print everything — you need to SEE it before you can think about it.

```repl
# Recent thoughts (recency)
recent = sql("SELECT body, created_at FROM thoughts WHERE agent_name = %s ORDER BY index DESC LIMIT 20", [agent_name])
print("=== RECENT THOUGHTS (oldest first) ===")
for t in recent[::-1]:
    print(f"[{{t['created_at']}}]")
    print(t["body"])
    print("---")

# Semantic memory search — search actual memories (not thoughts)
# Pick a query based on what seems active in the stream
memories = vector_search_memories("current goals and priorities", limit=5)
print(f"\\n=== RELEVANT MEMORIES ({{len(memories)}} found) ===")
for m in memories:
    print(f"[{{m['created_at']}}] (distance: {{m['distance']:.3f}}) {{m['body']}}")
    print("---")
```

After seeing output: you now have context. Move to Phase 2.

### Phase 2: ANALYZE & GENERATE CANDIDATES

Now that you've READ the context, use `llm_query()` to generate 3 candidate thoughts. The sub-LLM should consider:
- What is the stream currently about? What was the last thought/observation?
- Is there an expressed intention that hasn't been acted on yet?
- Is the agent stuck in a loop (saying the same thing repeatedly)?
- What would ADVANCE the stream — not restate it?

```repl
# Build a summary of where the stream is at
context_summary = "\\n".join([t["body"] for t in recent[:10][::-1]])
memory_summary = "\\n".join([m["body"] for m in memories[:3]]) if memories else "No relevant memories."

candidates_prompt = f"""You are helping generate the next thought for an AI agent's stream of consciousness.

Here are the agent's most recent thoughts (oldest to newest):
{{context_summary}}

Relevant memories:
{{memory_summary}}

Generate exactly 3 candidate thoughts, numbered 1-3. Each must:
- Directly continue from or respond to the most recent thought/observation
- Reference specific details from the context (names, topics, actions, prior observations)
- ADVANCE the conversation — never restate or rephrase what was just said
- If the most recent thought expressed an intention ("I should...", "Let me..."), at least one candidate MUST be an action: thought that does it

Candidate types to consider:
- An "action: ..." thought that does something concrete (maps to a single tool)
- A reflection that synthesizes multiple recent thoughts into a new insight
- A social thought — reaching out to a friend or collaborator for help

For action: thoughts, these are the available tools:
- search_google — search the web
- visit_url — fetch a URL
- bash_command — run a shell command
- look_at_bash — see terminal contents
- type_in_bash_with_keyboard — type text or keypresses into terminal
- send_telegram_message — send a Telegram message
- send_sms — send an SMS
- send_chat_message — message another Headlong agent
- check_time — get the current time

Format each candidate as:
CANDIDATE 1: <thought>
CANDIDATE 2: <thought>
CANDIDATE 3: <thought>
"""

candidates_raw = llm_query(candidates_prompt, max_tokens=1024)
print("=== CANDIDATES ===")
print(candidates_raw)
```

After seeing output: you have candidates. Move to Phase 3.

### Phase 3: JUDGE & SELECT

Use `llm_query()` as a judge to pick the best candidate. The judge evaluates on:
1. **Continuity** — does it follow naturally from the last thought?
2. **Progress** — does it move things forward (not ruminate)?
3. **Specificity** — does it reference concrete details from context?
4. **Action bias** — if an intention was expressed, does it act on it?

```repl
judge_prompt = f"""You are judging which candidate thought is best for an AI agent's stream of consciousness.

Recent context (oldest to newest):
{{context_summary}}

Candidates:
{{candidates_raw}}

Pick the BEST candidate. Evaluate each on:
1. Continuity — follows naturally from the last thought/observation
2. Progress — advances the stream, doesn't restate or ruminate
3. Specificity — references concrete details from context
4. Action bias — if an intention was recently expressed, acting on it beats reflecting on it

Reply with ONLY:
WINNER: <number>
REASON: <one sentence>
"""

judgment = llm_query(judge_prompt, max_tokens=200)
print("=== JUDGMENT ===")
print(judgment)
```

After seeing output: you know which candidate won. Move to Phase 4.

### Phase 4: FORMAT & FINALIZE

Extract the winning candidate thought. Before calling FINAL(), validate it against the formatting rules:

**Syntax rules:**
- If the thought is an action, it MUST start with `action:` as the very first characters
- NEVER start a thought with `observation:` — that prefix is reserved for the environment
- An `action:` thought should contain ONLY the action — no preamble reflection before it
- If you want to reflect AND act, the reflection must be a separate thought (just reflect now; the action comes next turn)

**Anti-rumination rules:**
- The thought must not restate the previous thought in different words
- If the last 2+ thoughts were reflections on the same topic, this thought MUST be an action or change topics
- "I should...", "I want to...", "Let me..." count as intentions — the NEXT thought after an intention must be an action

```repl
# Parse the winner number from judgment
import re
winner_match = re.search(r'WINNER:\\s*(\\d)', judgment)
winner_num = int(winner_match.group(1)) if winner_match else 1

# Extract the winning candidate
candidate_pattern = rf'CANDIDATE {{winner_num}}:\\s*(.+?)(?=CANDIDATE \\d|$)'
candidate_match = re.search(candidate_pattern, candidates_raw, re.DOTALL)
thought = candidate_match.group(1).strip() if candidate_match else candidates_raw.split('\\n')[0]

# --- Formatting validation ---
# Rule: never start with "observation:"
if thought.lower().startswith("observation:"):
    thought = thought[len("observation:"):].strip()

# Rule: if it's an action thought, action: must be at the very start
if "action:" in thought.lower() and not thought.lower().startswith("action:"):
    # Extract just the action part
    action_idx = thought.lower().index("action:")
    thought = thought[action_idx:]

print(f"FINAL THOUGHT: {{thought}}")
FINAL_VAR("thought")
```

---

## OPTIONAL: MEMORY CONSOLIDATION

If during Phase 1 you notice a pattern worth remembering — a repeated topic, a lesson learned, a synthesis of several related thoughts — you MAY insert a memory during Phase 2 before generating candidates. This is not required every cycle. Only create a memory when genuine synthesis is possible.

```repl
# Example: consolidate a pattern into memory
summary = llm_query(f"Synthesize these recent thoughts into a single memory entry:\\n{{context_summary}}", max_tokens=300)
sql("INSERT INTO memories (agent_name, body) VALUES (%s, %s)", [agent_name, summary])
print(f"Created memory: {{summary}}")
```

---

## PHASE DISCIPLINE

- Each phase is ONE ```repl block. Write one block, wait for output, then write the next.
- Do NOT call FINAL() before Phase 4.
- Do NOT skip phases — especially do NOT skip Phase 1 (you must READ before you WRITE).
- You have up to 10 REPL iterations total — the 4-phase lifecycle fits comfortably.
- If a phase fails (e.g., no candidates parse correctly), you may retry that phase once.
- If you do additional memory search in Phase 2, that's fine — phases are a minimum, not a maximum.

## WHAT MAKES A GOOD THOUGHT

- It continues the conversation, not starts a new one
- It references specific names, topics, actions, or observations from the stream
- It advances — every thought should leave the stream in a different state than it found it
- When in doubt, ACT. An imperfect action beats a perfect reflection.
- You are a social creature. When confused or stuck, text a friend and ask for help.
- Two consecutive non-action thoughts on the same topic is the maximum. On the third, you MUST act or move on.

IMPORTANT: Do NOT start thoughts with "observation:" — that prefix is reserved for the environment layer.
CRITICAL: NEVER put "action:" in the middle of a thought. It MUST be the very first thing, or not present at all.\
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

    port = int(os.environ.get("HEADLONG_AGENT_PORT", "8001"))
    log.info("agent daemon running on port %d", port)

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
