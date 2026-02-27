"""FastAPI API for the Environment daemon.

Provides env status and activity endpoints for the webapp.
Thought streaming has moved to the Agent daemon (port 8001).
"""

import logging
import time
from collections import deque
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

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
