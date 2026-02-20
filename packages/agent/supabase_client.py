"""Supabase client for the Agent daemon — config, thoughts, presence."""

import os
import logging
from typing import Optional
from uuid import uuid4

from supabase import create_client, Client
from supabase._async.client import create_client as create_async_client, AsyncClient

log = logging.getLogger(__name__)

AGENT_INSTANCE_ID = str(uuid4())

_client: Optional[Client] = None
_async_client: Optional[AsyncClient] = None


def get_client() -> Client:
    global _client
    if _client is not None:
        return _client
    url = os.environ.get("SUPABASE_URL_HEADLONG")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY_HEADLONG")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL_HEADLONG and SUPABASE_SERVICE_ROLE_KEY_HEADLONG must be set")
    _client = create_client(url, key)
    return _client


async def get_async_client() -> AsyncClient:
    global _async_client
    if _async_client is not None:
        return _async_client
    url = os.environ.get("SUPABASE_URL_HEADLONG")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY_HEADLONG")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL_HEADLONG and SUPABASE_SERVICE_ROLE_KEY_HEADLONG must be set")
    _async_client = await create_async_client(url, key)
    return _async_client


def get_agent_config(name: str) -> dict:
    """Fetch system_prompt + config from agents table."""
    sb = get_client()
    result = sb.table("agents").select("name, system_prompt, config").eq("name", name).single().execute()
    return result.data


def get_recent_thought_bodies(agent_name: str, limit: int = 50) -> list[str]:
    """Get recent thought bodies for use as assistant messages in the LLM context."""
    sb = get_client()
    result = (
        sb.table("thoughts")
        .select("body")
        .eq("agent_name", agent_name)
        .order("index", desc=True)
        .limit(limit)
        .execute()
    )
    rows = result.data or []
    rows.reverse()  # ascending order
    return [r["body"] for r in rows if r.get("body")]


def add_thought(agent_name: str, body: str, index: float, metadata: Optional[dict] = None) -> dict:
    """Write a completed thought to the database. Returns the inserted row."""
    sb = get_client()
    row = {
        "agent_name": agent_name,
        "body": body,
        "index": index,
        "metadata": metadata or {"last_updated_by": AGENT_INSTANCE_ID},
    }
    result = sb.table("thoughts").insert(row).execute()
    log.info("added thought index=%.2f body=%s...", index, body[:80])
    return result.data[0] if result.data else row


def get_max_thought_index(agent_name: str) -> float:
    """Get the current max index for an agent's thoughts."""
    sb = get_client()
    result = (
        sb.table("thoughts")
        .select("index")
        .eq("agent_name", agent_name)
        .order("index", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0]["index"] if rows else 0.0


async def subscribe_to_presence():
    """Track agent as online via presence channel."""
    sb = await get_async_client()
    channel = sb.channel("agent_presence_room", {
        "config": {
            "presence": {"key": "agent", "enabled": True},
            "broadcast": None,
            "private": False,
        }
    })
    await channel.subscribe()
    await channel.track({"online_at": __import__("datetime").datetime.now().isoformat()})
    log.info("tracking presence on agent_presence_room with key 'agent'")
    return channel
