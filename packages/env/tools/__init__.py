"""Tool registry for the Headlong agent."""

from typing import Callable
import logging

from tools.search import TOOL as search_tool
from tools.web import TOOL as web_tool
from tools.terminal import TOOL as terminal_tool, TOOLS as terminal_tools
from tools.telegram import TOOL as telegram_tool
from tools.time_tool import TOOL as time_tool

log = logging.getLogger(__name__)

# All tools, keyed by name
TOOLS: dict[str, dict] = {}


def register_tool(tool: dict) -> None:
    """Register a single tool."""
    TOOLS[tool["name"]] = tool


def register_all() -> None:
    """Register all available tools."""
    register_tool(search_tool)
    register_tool(web_tool)
    for t in terminal_tools:
        register_tool(t)
    register_tool(telegram_tool)
    register_tool(time_tool)
    log.info("registered tools: %s", list(TOOLS.keys()))


def get_claude_tool_schemas() -> list[dict]:
    """Return tool schemas in Claude's expected format."""
    return [
        {
            "name": tool["name"],
            "description": tool["description"],
            "input_schema": tool["parameters"],
        }
        for tool in TOOLS.values()
    ]


def get_tool_descriptions() -> list[str]:
    """Return human-readable tool descriptions for the system prompt."""
    return [f"{tool['name']} - {tool['description']}" for tool in TOOLS.values()]


async def execute_tool(name: str, args: dict) -> str:
    """Execute a tool by name and return the result as a string."""
    if name not in TOOLS:
        return f"observation: unknown tool '{name}'"
    tool = TOOLS[name]
    try:
        result = await tool["execute"](args)
        return result
    except Exception as e:
        log.exception("tool %s failed", name)
        return f"observation: tool '{name}' failed with error: {e}"
