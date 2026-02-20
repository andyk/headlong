"""FastAPI endpoints for the Agent daemon.

Provides thought generation streaming, loop control, and agent status.
"""

import logging
import time
from collections import deque
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import llm
import supabase_client

log = logging.getLogger(__name__)

app = FastAPI()

# --- Agent status / activity tracking ---

_start_time = time.monotonic()
_agent_name: str = ""
_system_prompt: str = ""
_activity_log: deque[dict] = deque(maxlen=100)
_loop_running: bool = False
_loop_task = None  # asyncio.Task for the generation loop


def set_agent_name(name: str) -> None:
    global _agent_name
    _agent_name = name


def set_system_prompt(prompt: str) -> None:
    global _system_prompt
    _system_prompt = prompt


def log_activity(message: str) -> None:
    """Append an activity entry visible to the webapp."""
    _activity_log.append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "message": message,
    })


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Available models
MODELS = [
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-6",
]


class GenerateRequest(BaseModel):
    agent_name: str | None = None
    model: str = llm.DEFAULT_MODEL
    temperature: float = llm.DEFAULT_TEMPERATURE
    max_tokens: int = llm.RLM_MAX_TOKENS


class LoopStartRequest(BaseModel):
    delay_ms: int = 5000
    model: str = llm.DEFAULT_MODEL
    temperature: float = llm.DEFAULT_TEMPERATURE
    max_tokens: int = llm.RLM_MAX_TOKENS


@app.get("/models")
def get_models():
    return JSONResponse(content=MODELS)


def _resolve_system_prompt(agent_name: str) -> str:
    """Re-fetch system prompt from DB and apply {agent_name} substitution."""
    global _system_prompt
    try:
        config = supabase_client.get_agent_config(agent_name)
        prompt = config.get("system_prompt", "")
        if prompt:
            prompt = prompt.replace("{agent_name}", agent_name)
            set_system_prompt(prompt)
    except Exception:
        pass  # use existing prompt
    return _system_prompt


@app.post("/generate")
async def generate_thought(req: GenerateRequest):
    """Generate a single thought via the RLM loop, save to DB, return JSON."""
    agent_name = req.agent_name or _agent_name
    log.info("generate request for agent=%s model=%s", agent_name, req.model)
    log_activity(f"Generating thought via RLM (model={req.model})")

    prompt = _resolve_system_prompt(agent_name)

    thought = await llm.run_rlm_loop(
        system_prompt=prompt,
        agent_name=agent_name,
        model=req.model,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
        on_step=log_activity,
    )

    log_activity(f"Generated thought: {thought[:80]}...")

    # Persist to DB so realtime subscribers see it
    next_index = supabase_client.get_max_thought_index(agent_name) + 1.0
    is_action = thought.strip().lower().startswith("action:")
    metadata = {"needs_handling": is_action, "last_updated_by": supabase_client.AGENT_INSTANCE_ID}
    row = supabase_client.add_thought(agent_name, thought, next_index, metadata)

    return JSONResponse(content={
        "id": row.get("id"),
        "body": thought,
        "index": next_index,
        "agent_name": agent_name,
    })


@app.post("/loop/start")
async def loop_start(req: LoopStartRequest):
    """Start the auto-generation loop."""
    import asyncio
    global _loop_running, _loop_task

    if _loop_running:
        return JSONResponse(content={"status": "already_running"})

    _loop_running = True
    log_activity(f"Loop started (delay={req.delay_ms}ms)")

    async def run_loop():
        global _loop_running
        while _loop_running:
            try:
                agent_name = _agent_name
                prompt = _resolve_system_prompt(agent_name)

                full_text = await llm.run_rlm_loop(
                    system_prompt=prompt,
                    agent_name=agent_name,
                    model=req.model,
                    max_tokens=req.max_tokens,
                    temperature=req.temperature,
                    on_step=log_activity,
                )

                next_index = supabase_client.get_max_thought_index(agent_name) + 1.0
                is_action = full_text.strip().lower().startswith("action:")
                metadata = {"needs_handling": is_action, "last_updated_by": supabase_client.AGENT_INSTANCE_ID}
                supabase_client.add_thought(agent_name, full_text, next_index, metadata)
                log_activity(f"Loop thought: {full_text[:80]}...")

                # Wait before generating next thought (longer for actions)
                wait_ms = req.delay_ms * 2 if is_action else req.delay_ms
                await asyncio.sleep(wait_ms / 1000.0)

            except Exception as e:
                log.error("loop error: %s", e)
                log_activity(f"Loop error: {e}")
                await asyncio.sleep(5)

    _loop_task = asyncio.create_task(run_loop())
    return JSONResponse(content={"status": "started", "delay_ms": req.delay_ms})


@app.post("/loop/stop")
async def loop_stop():
    """Stop the auto-generation loop."""
    global _loop_running, _loop_task
    _loop_running = False
    if _loop_task:
        _loop_task.cancel()
        _loop_task = None
    log_activity("Loop stopped")
    return JSONResponse(content={"status": "stopped"})


@app.get("/loop/status")
def loop_status():
    return JSONResponse(content={
        "running": _loop_running,
    })


@app.get("/agent/status")
def get_agent_status():
    uptime_seconds = int(time.monotonic() - _start_time)
    return JSONResponse(content={
        "agent_name": _agent_name,
        "system_prompt": _system_prompt[:200] if _system_prompt else "",
        "model": llm.DEFAULT_MODEL,
        "uptime_seconds": uptime_seconds,
    })


@app.get("/agent/activity")
def get_agent_activity():
    return JSONResponse(content=list(_activity_log))
