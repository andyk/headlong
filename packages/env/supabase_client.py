"""Supabase client for Headlong - thought CRUD and realtime subscriptions."""

import os
import logging
from typing import Callable, Optional
from uuid import uuid4

from supabase import create_client, Client
from supabase._async.client import create_client as create_async_client, AsyncClient

log = logging.getLogger(__name__)

ENV_INSTANCE_ID = str(uuid4())

# Sync client for DB operations (queries, inserts, updates)
_client: Optional[Client] = None
# Async client for realtime subscriptions
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


async def compute_insert_index(agent_name: str, insert_after_index: float) -> float:
    """Compute the index for inserting a thought after a given index (floating-point midpoint)."""
    log.debug("computing index for insert_after_index: %s", insert_after_index)
    sb = get_client()
    result = (
        sb.table("thoughts")
        .select("index")
        .eq("agent_name", agent_name)
        .order("index", desc=False)
        .gt("index", insert_after_index)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return insert_after_index + 1.0
    else:
        return (insert_after_index + rows[0]["index"]) / 2


async def add_thought(agent_name: str, body: str, insert_after_index: Optional[float] = None) -> None:
    """Insert a new thought into the database."""
    log.info("adding thought: %s (after index: %s)", body[:100], insert_after_index)
    sb = get_client()

    if insert_after_index is None:
        # Append: get max index
        result = (
            sb.table("thoughts")
            .select("index")
            .eq("agent_name", agent_name)
            .order("index", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        max_index = rows[0]["index"] if rows else 0
        log.debug("max_index: %s", max_index)
        sb.table("thoughts").insert({
            "agent_name": agent_name,
            "body": body,
            "index": max_index + 1.0,
        }).execute()
    else:
        computed_index = await compute_insert_index(agent_name, insert_after_index)
        log.debug("inserting thought with computed index: %s", computed_index)
        result = (
            sb.table("thoughts")
            .insert({
                "agent_name": agent_name,
                "body": body,
                "index": computed_index,
            })
            .execute()
        )
        if result.data:
            log.debug("inserted thought: %s", result.data)


async def get_recent_thoughts(agent_name: str, up_to_index: float, limit: int = 20) -> list[dict]:
    """Fetch thoughts up to (and including) the given index, ordered ascending."""
    sb = get_client()
    result = (
        sb.table("thoughts")
        .select("*")
        .eq("agent_name", agent_name)
        .order("index", desc=True)
        .lte("index", up_to_index)
        .limit(limit)
        .execute()
    )
    thoughts = result.data or []
    thoughts.reverse()  # Return in ascending order
    return thoughts


async def mark_thought_handled(thought_id: str, agent_name: str, metadata: dict) -> None:
    """Mark a thought as handled by setting needs_handling=false."""
    sb = get_client()
    updated_metadata = {**metadata, "needs_handling": False, "last_updated_by": ENV_INSTANCE_ID}
    sb.table("thoughts").update({"metadata": updated_metadata}).eq("id", thought_id).eq("agent_name", agent_name).execute()


async def subscribe_to_thoughts(callback: Callable):
    """Subscribe to realtime changes on the thoughts table using async client."""
    sb = await get_async_client()

    def on_change(payload):
        log.debug("realtime payload type=%s", type(payload).__name__)
        # Extract the record from the realtime payload.
        # The supabase-py SDK passes the callback a dict like:
        #   {"data": {"record": {...}, "type": "INSERT"|"UPDATE", ...}, "ids": [...]}
        record = None
        if isinstance(payload, dict):
            data = payload.get("data", {})
            if isinstance(data, dict):
                record = data.get("record") or data.get("new")
            if not record:
                record = payload.get("record") or payload.get("new")
        elif hasattr(payload, 'data'):
            data = payload.data
            if isinstance(data, dict):
                record = data.get("record") or data.get("new")
        if record and isinstance(record, dict) and "body" in record:
            log.info("realtime thought: id=%s agent=%s body=%s...",
                     record.get("id", "?"), record.get("agent_name", "?"), record.get("body", "")[:80])
            callback(record)
        else:
            log.debug("realtime payload had no usable record")

    channel = sb.channel("any")
    channel.on_postgres_changes(
        event="*",
        schema="public",
        table="thoughts",
        callback=on_change,
    )
    await channel.subscribe()
    log.info("subscribed to thoughts realtime channel")
    return channel


def update_thought_embedding(thought_id: str, embedding: list[float]) -> None:
    """Store an embedding vector for a thought."""
    sb = get_client()
    sb.table("thoughts").update({"embedding": str(embedding)}).eq("id", thought_id).execute()


def get_environment_config(name: str) -> dict:
    """Fetch system_prompt + config from environments table."""
    sb = get_client()
    result = sb.table("environments").select("name, system_prompt, config").eq("name", name).single().execute()
    return result.data


async def subscribe_to_presence():
    """Subscribe to presence channel and track env status so the webapp sees us."""
    sb = await get_async_client()
    channel = sb.channel("env_presence_room", {
        "config": {
            "presence": {"key": "env", "enabled": True},
            "broadcast": None,
            "private": False,
        }
    })
    await channel.subscribe()
    await channel.track({"online_at": __import__("datetime").datetime.now().isoformat()})
    log.info("tracking presence on env_presence_room with key 'env'")
    return channel
