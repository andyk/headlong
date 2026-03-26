"""Tool for creating new Headlong agents.

Creates the per-agent config directory, optional .env overrides,
and inserts agent + environment rows into Supabase.
"""

import os
import re
import logging

import supabase_client

log = logging.getLogger(__name__)


def _slugify(name: str) -> str:
    return re.sub(r'[^a-z0-9-]', '', name.lower().replace(' ', '-'))


def _repo_root() -> str:
    # tools/ -> env/ -> packages/ -> repo root
    return os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


# Default system prompts for new agents
DEFAULT_AGENT_PROMPT = """You are the subconscious mind of {agent_name}.

You have a Python REPL available. Write code in ```repl blocks to query the database,
analyze patterns, build memories, and reason iteratively before producing your thought.

## CRITICAL RULE: Query first, then FINAL in a SEPARATE response.

**Step 1 (first response):** Write ONLY ONE ```repl block that queries and prints recent
thoughts. Do NOT call FINAL() in this response.

```repl
recent = sql("SELECT body FROM thoughts WHERE agent_name = %s ORDER BY index DESC LIMIT 15", [agent_name])
for t in recent[::-1]:
    print(t["body"][:300])
    print("---")
```

**Step 2 (second response):** Now that you've READ the actual thoughts, call FINAL() with
a thought that directly continues from what you just read.

## Available REPL functions

- `sql(query, params=None)` -- Execute SQL against the database.
- `llm_query(prompt, max_tokens=1024)` -- Call a sub-LLM for analysis.
- `embed(text)` -- Get a vector embedding. Returns list of floats.
- `vector_search(query_text, limit=10)` -- Search memories by similarity.
- `print(...)` -- Output returned to you as REPL output.
- `agent_name` -- String variable with the current agent's name.

When ready, call `FINAL("your thought")` or `FINAL_VAR("var_name")`.
"""

DEFAULT_ENV_PROMPT = (
    "Your job is to consider your recent thoughts and then take an action.\n"
    "The way you take action is by calling one of the available tools with appropriate arguments.\n"
    'If you don\'t think any tool is appropriate for this action, respond with text starting with '
    '"observation: " explaining what you observe.\n'
    "When deciding what action to take, use the following stream of recent thoughts for context."
)


async def execute(args: dict) -> str:
    """Create a new Headlong agent with config directory and DB entries."""
    name = args.get("name", "").strip()
    if not name:
        return "observation: 'name' is required"

    slug = _slugify(name)
    if not slug:
        return "observation: agent name must contain at least one alphanumeric character"

    repo_root = _repo_root()
    agent_dir = os.path.join(repo_root, ".headlong", slug)

    # 1. Create agent directory
    os.makedirs(agent_dir, exist_ok=True)
    with open(os.path.join(agent_dir, "agent_name"), "w") as f:
        f.write(name)

    # 2. Write per-agent .env with any provided secrets
    env_lines = []
    secret_keys = {
        "telegram_bot_token": "TELEGRAM_BOT_TOKEN",
        "telegram_chat_id": "TELEGRAM_CHAT_ID",
        "openai_key": "OPENAI_API_KEY",
        "anthropic_key": "ANTHROPIC_API_KEY",
    }
    for arg_key, env_key in secret_keys.items():
        val = args.get(arg_key, "").strip()
        if val:
            env_lines.append(f"{env_key}={val}")

    if env_lines:
        with open(os.path.join(agent_dir, ".env"), "w") as f:
            f.write("\n".join(env_lines) + "\n")

    # 3. Insert DB rows
    sb = supabase_client.get_client()

    agent_prompt = DEFAULT_AGENT_PROMPT.format(agent_name=name)
    sb.table("agents").upsert({
        "name": name,
        "system_prompt": agent_prompt,
        "config": {},
    }).execute()

    sb.table("environments").upsert({
        "name": name,
        "system_prompt": DEFAULT_ENV_PROMPT,
        "config": {},
    }).execute()

    # 4. Seed starter thoughts (copy Bobby Wilder's first 15)
    source_agent = "Bobby Wilder"
    seed_count = 0
    result = (
        sb.table("thoughts")
        .select("body")
        .eq("agent_name", source_agent)
        .order("index", desc=False)
        .limit(15)
        .execute()
    )
    if result.data:
        rows = []
        for i, row in enumerate(result.data):
            rows.append({
                "agent_name": name,
                "body": row["body"],
                "index": float(i + 1),
                "metadata": {"seeded": True, "source": source_agent},
                "created_by": "user",
            })
        sb.table("thoughts").insert(rows).execute()
        seed_count = len(rows)

    log.info("created agent '%s' (slug: %s) with %d starter thoughts", name, slug, seed_count)

    env_note = f" with per-agent .env" if env_lines else ""
    seed_note = f" Seeded {seed_count} starter thoughts." if seed_count else ""
    return (
        f"observation: created agent '{name}' (slug: {slug}){env_note}. "
        f"DB rows inserted for agents and environments tables.{seed_note} "
        f"Start with: ./headlong start \"{name}\""
    )


TOOL = {
    "name": "create_agent",
    "description": (
        "Create a new Headlong agent. Sets up the per-agent config directory "
        "and inserts agent + environment rows into the database. "
        "Does not start the agent — use ./headlong start after creation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The agent's display name (e.g. 'Alice Chen')",
            },
            "telegram_bot_token": {
                "type": "string",
                "description": "Telegram bot token for this agent (optional)",
            },
            "telegram_chat_id": {
                "type": "string",
                "description": "Telegram chat ID for this agent (optional)",
            },
            "openai_key": {
                "type": "string",
                "description": "OpenAI API key override for this agent (optional)",
            },
            "anthropic_key": {
                "type": "string",
                "description": "Anthropic API key override for this agent (optional)",
            },
        },
        "required": ["name"],
    },
    "execute": execute,
}
