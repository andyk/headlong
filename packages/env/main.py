"""Headlong env daemon - main entry point.

Runs the agent loop (Supabase realtime -> Claude -> tools -> thoughts)
and serves the thought streaming API for the webapp on port 8000.
"""

import os
import sys
import signal
import asyncio
import logging
import threading

import uvicorn
from dotenv import load_dotenv
from openai import OpenAI

# Load .env from project root
load_dotenv(dotenv_path="../../.env")

import supabase_client
import llm
import tools
from tools.telegram import start_listener as start_telegram_listener, stop_listener as stop_telegram_listener
from thought_api import app as fastapi_app, set_agent_name, log_activity

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
# Quiet down noisy loggers
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("telegram").setLevel(logging.INFO)
logging.getLogger("websockets").setLevel(logging.INFO)
logging.getLogger("realtime._async.client").setLevel(logging.INFO)
logging.getLogger("realtime._async.channel").setLevel(logging.INFO)
log = logging.getLogger(__name__)

NUM_THOUGHTS_TO_CONSIDER = 20
MIN_BODY_LENGTH_FOR_EMBEDDING = 10


async def embed_thought(thought: dict) -> None:
    """Generate and store an embedding for a thought."""
    thought_id = thought.get("id")
    body = thought.get("body", "")
    if not thought_id or len(body.strip()) < MIN_BODY_LENGTH_FOR_EMBEDDING:
        return
    try:
        oai = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        response = oai.embeddings.create(
            model="text-embedding-3-small",
            input=body,
        )
        vector = response.data[0].embedding
        supabase_client.update_thought_embedding(thought_id, vector)
        log.info("embedded thought %s (%d chars)", thought_id, len(body))
        log_activity(f"Embedded thought {thought_id[:8]}... ({len(body)} chars)")
    except Exception as e:
        log.warning("failed to embed thought %s: %s", thought_id, e)


_handled_ids: set[str] = set()

async def handle_thought(thought: dict, agent_name: str) -> None:
    """Handle an incoming thought that needs action."""
    body = thought.get("body", "")
    metadata = thought.get("metadata") or {}

    # Only handle thoughts that start with "action: " and have needs_handling=true
    if not (
        body.lower().startswith("action: ")
        and isinstance(metadata, dict)
        and metadata.get("needs_handling") is True
    ):
        return

    thought_id = thought.get("id")

    # Dedup: Realtime can deliver the same thought multiple times
    if thought_id in _handled_ids:
        return
    _handled_ids.add(thought_id)

    thought_index = thought.get("index", 0)
    log.info(
        "handling ACTION (needs_handling). id=%s index=%s body=%s...",
        thought_id,
        thought_index,
        body[:100],
    )
    log_activity(f"Received action: {body[:120]}")

    # Mark as handled to prevent re-processing
    await supabase_client.mark_thought_handled(thought_id, agent_name, metadata)

    # Get recent thoughts up to this one
    thoughts = await supabase_client.get_recent_thoughts(
        agent_name, thought_index, limit=NUM_THOUGHTS_TO_CONSIDER
    )
    if not thoughts:
        log.warning("no thoughts found for agent %s", agent_name)
        log_activity(f"No thoughts found for agent {agent_name}")
        return

    # Get tool schemas and descriptions
    tool_schemas = tools.get_claude_tool_schemas()
    tool_descriptions = tools.get_tool_descriptions()

    # Re-fetch env system prompt in case it was edited
    try:
        env_config = supabase_client.get_environment_config(agent_name)
        env_prompt = env_config.get("system_prompt", "")
        if env_prompt:
            llm.set_env_system_prompt(env_prompt)
    except Exception:
        pass

    # Call Claude
    log_activity(f"Calling Claude with {len(thoughts)} thoughts, {len(tool_schemas)} tools")
    result = llm.generate_action(
        thoughts=thoughts,
        tools=tool_schemas,
        tool_descriptions=tool_descriptions,
    )

    if result["type"] == "text":
        # Claude responded with text - add as new thought
        await supabase_client.add_thought(agent_name, result["content"])
        log.info("added text thought: %s", result["content"][:100])
        log_activity(f"Claude responded with text: {result['content'][:100]}")
    elif result["type"] == "tool_use":
        # Claude called a tool - execute it and add observation
        tool_name = result["name"]
        tool_args = result["args"]
        log.info("executing tool: %s with args: %s", tool_name, tool_args)
        log_activity(f"Claude called tool: {tool_name}({tool_args})")
        observation = await tools.execute_tool(tool_name, tool_args)
        await supabase_client.add_thought(agent_name, observation, insert_after_index=thought_index)
        log.info("added observation: %s", observation[:100])
        log_activity(f"Tool result: {observation[:100]}")


def start_api_server():
    """Start the FastAPI thought streaming server in a background thread."""
    config = uvicorn.Config(fastapi_app, host="0.0.0.0", port=8000, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    log.info("thought streaming API started on port 8000")


async def main():
    # Parse agent name from CLI
    if len(sys.argv) < 2:
        print("Usage: python main.py <agent_name>")
        sys.exit(1)

    agent_name = sys.argv[1]
    log.info("starting headlong env daemon for agent: %s", agent_name)
    set_agent_name(agent_name)

    # Fetch env system prompt from Supabase
    try:
        env_config = supabase_client.get_environment_config(agent_name)
        env_prompt = env_config.get("system_prompt", "")
        if env_prompt:
            llm.set_env_system_prompt(env_prompt)
            log.info("loaded env system prompt from Supabase (%d chars)", len(env_prompt))
            log_activity(f"Loaded env system prompt ({len(env_prompt)} chars)")
        else:
            log.warning("no env system prompt in DB, using default")
            log_activity("Using default env system prompt")
    except Exception as e:
        log.warning("failed to fetch env config: %s (using default)", e)
        log_activity(f"Env config fetch failed: {e} (using default)")

    # Initialize tools
    tools.register_all()
    log_activity(f"Environment started for agent: {agent_name}")
    log_activity(f"Registered {len(tools.TOOLS)} tools: {', '.join(tools.TOOLS.keys())}")

    # Start the thought streaming API server
    start_api_server()

    # Realtime heartbeat — periodically verify the subscription is alive
    # by writing a probe row and checking if the callback fires.
    HEARTBEAT_INTERVAL = 120  # seconds between checks
    HEARTBEAT_TIMEOUT = 15    # seconds to wait for callback
    heartbeat_event = asyncio.Event()

    # Subscribe to thoughts via Supabase Realtime (async)
    loop = asyncio.get_running_loop()

    def on_thought(thought: dict):
        # Signal heartbeat if this is a probe thought
        if thought.get("body", "").startswith("__heartbeat_probe__"):
            heartbeat_event.set()
            return  # don't process probe thoughts
        loop.call_soon_threadsafe(
            asyncio.ensure_future, handle_thought(thought, agent_name)
        )
        loop.call_soon_threadsafe(
            asyncio.ensure_future, embed_thought(thought)
        )

    channel = await supabase_client.subscribe_to_thoughts(on_thought)

    # Subscribe to presence
    presence_channel = await supabase_client.subscribe_to_presence()

    # Start Telegram listener — incoming messages become thoughts
    async def on_telegram_message(chat_id: str, text: str):
        log.info("telegram -> thought: %s", text[:100])
        log_activity(f"Telegram message from {chat_id}: {text[:120]}")
        await supabase_client.add_thought(agent_name, text)

    await start_telegram_listener(on_telegram_message)

    log.info("env daemon running. Listening for thoughts...")
    log.info("registered tools: %s", list(tools.TOOLS.keys()))

    async def realtime_heartbeat():
        nonlocal channel
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            heartbeat_event.clear()
            probe_id = None
            try:
                # Insert a probe thought
                sb = supabase_client.get_client()
                result = sb.table("thoughts").insert({
                    "agent_name": agent_name,
                    "body": "__heartbeat_probe__",
                    "index": -1,
                }).execute()
                if result.data:
                    probe_id = result.data[0]["id"]

                # Wait for the callback to fire
                try:
                    await asyncio.wait_for(heartbeat_event.wait(), timeout=HEARTBEAT_TIMEOUT)
                    log.debug("realtime heartbeat OK")
                except asyncio.TimeoutError:
                    log.warning("realtime heartbeat FAILED — resubscribing")
                    log_activity("Realtime heartbeat failed — resubscribing")
                    try:
                        await channel.unsubscribe()
                    except Exception:
                        pass
                    channel = await supabase_client.subscribe_to_thoughts(on_thought)
                    log_activity("Realtime resubscribed")
            except Exception as e:
                log.warning("realtime heartbeat error: %s", e)
            finally:
                # Clean up the probe thought
                if probe_id:
                    try:
                        sb.table("thoughts").delete().eq("id", probe_id).execute()
                    except Exception:
                        pass

    asyncio.ensure_future(realtime_heartbeat())

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
