"""Inter-agent chat messaging via Supabase.

Supports sending messages (tool) and receiving messages (Realtime listener).
Incoming chat messages are inserted as thoughts into Supabase.
"""

import logging
from typing import Callable, Awaitable, Optional

import supabase_client

log = logging.getLogger(__name__)

# Realtime channel — set by start_listener()
_channel = None


async def execute(args: dict) -> str:
    """Send a chat message to another agent."""
    to_agent = args.get("to_agent")
    body = args.get("body", "")

    if not to_agent:
        return "observation: 'to_agent' is required"
    if not body:
        return "observation: 'body' is required"

    # We need to know who we are — stored by start_listener()
    from_agent = _from_agent or "unknown"

    log.info("sending chat message from %s to %s: %s", from_agent, to_agent, body[:100])

    sb = supabase_client.get_client()
    sb.table("chat_messages").insert({
        "from_agent": from_agent,
        "to_agent": to_agent,
        "body": body,
    }).execute()

    return f"observation: sent chat message to {to_agent} with body:\n{body}"


_from_agent: Optional[str] = None


async def start_listener(agent_name: str, on_message: Callable[[str, str], Awaitable[None]]):
    """Subscribe to Realtime for incoming chat messages.

    Args:
        agent_name: This agent's name (filter for to_agent).
        on_message: async callback(from_agent, formatted_text) called for each message.
    """
    global _channel, _from_agent
    _from_agent = agent_name

    sb = await supabase_client.get_async_client()

    def on_change(payload):
        log.info("chat realtime payload: %s", payload)
        record = None
        if isinstance(payload, dict):
            data = payload.get("data", {})
            if isinstance(data, dict):
                record = data.get("record") or data.get("new")
            if not record:
                record = payload.get("record") or payload.get("new")
        elif hasattr(payload, "data"):
            data = payload.data
            if isinstance(data, dict):
                record = data.get("record") or data.get("new")

        if not record or not isinstance(record, dict):
            log.debug("chat realtime payload had no usable record")
            return

        # Only process messages addressed to this agent
        if record.get("to_agent") != agent_name:
            return

        from_agent = record.get("from_agent", "unknown")
        body = record.get("body", "")
        log.info("chat message from %s: %s", from_agent, body[:100])

        import asyncio
        loop = asyncio.get_event_loop()
        loop.call_soon_threadsafe(
            asyncio.ensure_future,
            on_message(from_agent, f"observation: received chat message from {from_agent}: {body}"),
        )

    channel = sb.channel("chat_messages")
    channel.on_postgres_changes(
        event="INSERT",
        schema="public",
        table="chat_messages",
        callback=on_change,
    )
    await channel.subscribe()
    _channel = channel
    log.info("chat listener started for agent: %s", agent_name)


async def stop_listener():
    """Unsubscribe from the chat Realtime channel."""
    global _channel
    if _channel:
        await _channel.unsubscribe()
        _channel = None
        log.info("chat listener stopped")


TOOL = {
    "name": "send_chat_message",
    "description": "Send a chat message to another Headlong agent.",
    "parameters": {
        "type": "object",
        "properties": {
            "to_agent": {
                "type": "string",
                "description": "The name of the agent to send the message to",
            },
            "body": {
                "type": "string",
                "description": "The message to send",
            },
        },
        "required": ["to_agent", "body"],
    },
    "execute": execute,
}
