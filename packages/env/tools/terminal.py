"""Terminal management via tmux (replaces terminalServer + ht binary)."""

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


async def new_window(args: dict) -> str:
    """Create a new tmux window."""
    session = get_session()
    window_id = args.get("windowID", "default")
    shell_path = args.get("shellPath", "/bin/bash")

    window = session.new_window(
        window_name=window_id,
        window_shell=shell_path,
    )
    log.info("created new window: %s", window_id)
    return f"observation: created new terminal window '{window_id}'"


async def switch_to_window(args: dict) -> str:
    """Switch to a specific tmux window."""
    session = get_session()
    window_id = args.get("id", "")

    for window in session.windows:
        if window.window_name == window_id:
            window.select()
            return f"observation: switched to window '{window_id}'"

    return f"observation: window '{window_id}' not found"


async def run_command(args: dict) -> str:
    """Run a command in the active tmux window."""
    session = get_session()
    command = args.get("command", "")

    window = session.active_window
    pane = window.active_pane
    pane.send_keys(command, enter=True)
    log.info("ran command in window '%s': %s", window.window_name, command)

    # Brief wait then capture output
    import asyncio
    await asyncio.sleep(1)

    output = pane.capture_pane()
    output_text = "\n".join(output) if isinstance(output, list) else str(output)
    return f"observation: ran command '{command}' in window '{window.window_name}':\n{output_text}"


async def look_at_window(args: dict) -> str:
    """Capture the contents of the active tmux window."""
    session = get_session()
    window = session.active_window
    pane = window.active_pane

    output = pane.capture_pane()
    output_text = "\n".join(output) if isinstance(output, list) else str(output)
    return f"observation: contents of window '{window.window_name}':\n{output_text}"


async def list_windows(args: dict) -> str:
    """List all tmux windows."""
    session = get_session()
    window_names = [w.window_name for w in session.windows]
    return f"observation: open windows: {', '.join(window_names)}"


async def which_window_active(args: dict) -> str:
    """Get the active window name."""
    session = get_session()
    window = session.active_window
    return f"observation: active window is '{window.window_name}'"


async def type_keys(args: dict) -> str:
    """Send arbitrary keystrokes to the active window."""
    session = get_session()
    keys = args.get("keys", "")
    window = session.active_window
    pane = window.active_pane
    pane.send_keys(keys, enter=False)
    return f"observation: typed keys into window '{window.window_name}'"


# Individual tool definitions
TOOLS = [
    {
        "name": "newWindow",
        "description": "Create a new terminal window.",
        "parameters": {
            "type": "object",
            "properties": {
                "shellPath": {
                    "type": "string",
                    "description": "Path of shell binary to open, e.g. /bin/bash",
                },
                "windowID": {
                    "type": "string",
                    "description": "Unique ID for the new window",
                },
            },
        },
        "execute": new_window,
    },
    {
        "name": "switchToWindow",
        "description": "Switch to the specified window, i.e. 'bring it to the front'.",
        "parameters": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "The ID of the window to switch to",
                },
            },
            "required": ["id"],
        },
        "execute": switch_to_window,
    },
    {
        "name": "executeWindowCommand",
        "description": "Run a command in the currently active terminal window.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The command to execute in the active window",
                },
            },
            "required": ["command"],
        },
        "execute": run_command,
    },
    {
        "name": "lookAtActiveWindow",
        "description": "Look at the contents of the currently active terminal window.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
        "execute": look_at_window,
    },
    {
        "name": "listWindows",
        "description": "List the IDs of all currently open terminal windows.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
        "execute": list_windows,
    },
    {
        "name": "whichWindowActive",
        "description": "Get the ID of the currently active terminal window.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
        "execute": which_window_active,
    },
    {
        "name": "typeWithKeyboard",
        "description": "Type at the keyboard into the active terminal window.",
        "parameters": {
            "type": "object",
            "properties": {
                "keys": {
                    "type": "string",
                    "description": "Description of what to type into the active window",
                },
            },
            "required": ["keys"],
        },
        "execute": type_keys,
    },
]

# For backwards compat in the registry
TOOL = TOOLS[0]
