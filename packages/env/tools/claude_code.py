"""Claude Code tool — run Claude Code in headless pipe mode.

Lets the agent delegate coding tasks to Claude Code without trying to
drive the interactive TUI through tmux keystrokes.  Uses `claude -p`
(pipe mode) which reads a prompt, does the work, and prints the result.

Session persistence: the session ID from the first call is stored and
reused on subsequent calls via `--resume`, so Claude Code retains its
conversation history across action thoughts.
"""

import asyncio
import json
import logging
import shutil

log = logging.getLogger(__name__)

# Timeout for a single Claude Code run (10 minutes)
CLAUDE_CODE_TIMEOUT = 600

# Persistent session ID — set after the first successful run
_session_id: str | None = None


async def run_claude_code(args: dict) -> str:
    """Run Claude Code in pipe mode on a task."""
    global _session_id

    prompt = args.get("prompt", "")
    workdir = args.get("workdir", "/app/headlong")
    dangerously_skip_permissions = args.get("dangerouslySkipPermissions", True)
    new_session = args.get("newSession", False)

    if not prompt:
        return "observation: claude_code error — prompt is required"

    # Make sure claude is installed
    claude_bin = shutil.which("claude")
    if not claude_bin:
        return "observation: claude_code error — 'claude' CLI not found in PATH"

    cmd = [claude_bin, "-p", "--output-format", "json"]
    if dangerously_skip_permissions:
        cmd.append("--dangerously-skip-permissions")

    # Resume previous session if we have one (unless explicitly starting fresh)
    if new_session:
        _session_id = None
    if _session_id:
        cmd.extend(["--resume", _session_id])
        log.info("resuming claude code session %s", _session_id)

    log.info("running claude code in %s: %s", workdir, prompt[:120])

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=workdir,
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=prompt.encode()),
            timeout=CLAUDE_CODE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        proc.kill()
        return f"observation: claude_code timed out after {CLAUDE_CODE_TIMEOUT}s"

    stdout_text = stdout.decode(errors="replace").strip()
    stderr_text = stderr.decode(errors="replace").strip()

    if proc.returncode != 0:
        return (
            f"observation: claude_code exited with code {proc.returncode}\n"
            f"stderr: {stderr_text[:2000]}\n"
            f"stdout: {stdout_text[:2000]}"
        )

    # Parse JSON output — extract result and session ID
    result_text, session_id = _extract_result(stdout_text)

    # Store session ID for next call
    if session_id:
        _session_id = session_id
        log.info("claude_code session_id: %s", _session_id)

    log.info("claude_code finished (%d chars output)", len(result_text))
    return f"observation: claude_code result:\n{result_text}"


def _extract_result(raw: str) -> tuple[str, str | None]:
    """Extract human-readable result and session ID from Claude Code JSON output.

    Returns (result_text, session_id).
    """
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            result = data.get("result", raw)
            session_id = data.get("session_id")
            return result, session_id
        return raw, None
    except (json.JSONDecodeError, TypeError):
        return raw, None


TOOL = {
    "name": "claudeCode",
    "description": (
        "Delegate a coding task to Claude Code (an AI coding agent). "
        "Claude Code will read files, write code, run tests, and return "
        "the result. Use this for: building features, refactoring code, "
        "debugging, code review, exploring/understanding a codebase, or "
        "any task that requires reading and writing files. "
        "Do NOT use this for simple one-line observations — only for "
        "tasks that benefit from an AI coding agent with full file access. "
        "Sessions persist across calls — Claude Code remembers previous "
        "work. Set newSession=true to start fresh."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": (
                    "The task to give Claude Code. Be specific: include "
                    "file paths, what to change, and what the expected "
                    "outcome is. Example: 'Read packages/env/main.py and "
                    "summarize the architecture' or 'Add input validation "
                    "to the login form in src/Login.tsx'."
                ),
            },
            "workdir": {
                "type": "string",
                "description": (
                    "Working directory for Claude Code. Defaults to "
                    "/app/headlong (the repo root inside Docker)."
                ),
                "default": "/app/headlong",
            },
            "newSession": {
                "type": "boolean",
                "description": (
                    "Start a new Claude Code session instead of continuing "
                    "the previous one. Use when switching to an unrelated task."
                ),
                "default": False,
            },
        },
        "required": ["prompt"],
    },
    "execute": run_claude_code,
}
