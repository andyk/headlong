"""Terminal access via tmux — single bash window."""

import asyncio
import logging
from typing import Optional

import libtmux

log = logging.getLogger(__name__)

SESSION_NAME = "headlong"

_server: Optional[libtmux.Server] = None
_session: Optional[libtmux.Session] = None


def get_session() -> libtmux.Session:
    """Get or create the headlong tmux session."""
    global _server, _session
    if _session is not None:
        try:
            _session.id  # check it's still alive
            return _session
        except Exception:
            _session = None

    _server = libtmux.Server()

    # Try to attach to existing session
    try:
        _session = _server.sessions.get(session_name=SESSION_NAME)
        if _session:
            log.info("attached to existing tmux session: %s", SESSION_NAME)
            return _session
    except Exception:
        pass

    # Create new session
    _session = _server.new_session(session_name=SESSION_NAME)
    log.info("created new tmux session: %s", SESSION_NAME)
    return _session


async def bash_command(args: dict) -> str:
    """Run a command in the active bash window."""
    session = get_session()
    command = args.get("command", "")

    pane = session.active_window.active_pane
    pane.send_keys(command, enter=True)
    log.info("bash_command: %s", command)

    await asyncio.sleep(1)

    output = pane.capture_pane()
    output_text = "\n".join(output) if isinstance(output, list) else str(output)
    return f"observation: ran '{command}':\n{output_text}"


async def look_at_bash(args: dict) -> str:
    """Look at the contents of the active bash window."""
    session = get_session()
    pane = session.active_window.active_pane

    output = pane.capture_pane()
    output_text = "\n".join(output) if isinstance(output, list) else str(output)
    return f"observation: bash window contents:\n{output_text}"


async def type_in_bash(args: dict) -> str:
    """Type at the keyboard into the active bash window."""
    session = get_session()
    keys = args.get("keys", "")
    pane = session.active_window.active_pane

    # tmux send-keys treats certain names as special keys (Enter, Escape,
    # Up, Down, C-c, etc.).  If the string looks like a tmux key name or
    # modifier combo, send it as a key; otherwise send as literal text.
    TMUX_SPECIAL_KEYS = {
        "enter", "return", "escape", "tab", "btab", "bspace",
        "up", "down", "left", "right",
        "home", "end", "pageup", "pagedown", "ppage", "npage",
        "space", "dc",
    }

    stripped = keys.strip()
    is_special = (
        stripped.lower() in TMUX_SPECIAL_KEYS
        or (len(stripped) <= 5 and stripped[:2] in ("C-", "M-"))
    )

    if is_special:
        log.info("type_in_bash: sending special key '%s' via pane.cmd('send-keys', ...)", stripped)
        pane.cmd("send-keys", stripped)
        # Special keys (Enter, Escape, etc.) need more time for TUI apps to process
        await asyncio.sleep(1.0)
    else:
        log.info("type_in_bash: sending literal text '%s' via pane.send_keys(enter=False)", stripped)
        pane.send_keys(stripped, enter=False)
        await asyncio.sleep(0.3)

    output = pane.capture_pane()
    output_text = "\n".join(output) if isinstance(output, list) else str(output)
    return f"observation: typed '{keys}' in bash. bash window now shows:\n{output_text}"


TOOLS = [
    {
        "name": "bash_command",
        "description": "Run a command in the currently active bash window.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The command to execute",
                },
            },
            "required": ["command"],
        },
        "execute": bash_command,
    },
    {
        "name": "look_at_bash",
        "description": "Look at the contents of the currently active bash window.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
        "execute": look_at_bash,
    },
    {
        "name": "type_in_bash_with_keyboard",
        "description": "Type at the keyboard into the active bash window. Use tmux syntax for special keys (e.g. Enter, Escape, C-c, Up, Down, Tab).",
        "parameters": {
            "type": "object",
            "properties": {
                "keys": {
                    "type": "string",
                    "description": "What to type. Use tmux key names for special keys (Enter, Escape, C-c, Up, Down, Tab, BSpace, etc.)",
                },
            },
            "required": ["keys"],
        },
        "execute": type_in_bash,
    },
]

TOOL = TOOLS[0]
