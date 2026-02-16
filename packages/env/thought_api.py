"""FastAPI thought streaming API (merged from thought_server).

Provides endpoints for the webapp to stream thought generation via Claude.
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

log = logging.getLogger(__name__)

app = FastAPI()

# --- Environment status / activity tracking ---

_start_time = time.monotonic()
_agent_name: str = ""
_activity_log: deque[dict] = deque(maxlen=100)


def set_agent_name(name: str) -> None:
    global _agent_name
    _agent_name = name


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

# Available models (Claude variants)
MODELS = [
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-6",
]


class CompletionRequest(BaseModel):
    model: str
    system_message: str
    user_message: str
    assistant_messages: list[str]
    max_tokens: int = 1024
    temperature: float = 0.5


@app.get("/models")
def get_models():
    return JSONResponse(content=MODELS)


@app.post("/")
async def stream_thought(item: CompletionRequest):
    log.info("received thought stream request for model: %s", item.model)
    return StreamingResponse(
        llm.stream_completion(
            system_message=item.system_message,
            user_message=item.user_message,
            assistant_messages=item.assistant_messages,
            model=item.model,
            max_tokens=item.max_tokens,
            temperature=item.temperature,
        ),
        media_type="text/event-stream",
    )


@app.get("/env/status")
def get_env_status():
    import tools as _tools
    tool_list = [
        {"name": t["name"], "description": t["description"]}
        for t in _tools.TOOLS.values()
    ]
    uptime_seconds = int(time.monotonic() - _start_time)
    return JSONResponse(content={
        "agent_name": _agent_name,
        "tools": tool_list,
        "uptime_seconds": uptime_seconds,
    })


@app.get("/env/activity")
def get_env_activity():
    return JSONResponse(content=list(_activity_log))
