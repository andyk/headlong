"""Recursive LM integration for Headlong.

Provides an alternative to the standard "call Claude once -> get action" pattern.
Uses RLM to allow the agent to recursively reason about sub-problems and execute
Python code that can call tools and query itself.
"""

import os
import logging
from typing import Optional

log = logging.getLogger(__name__)

_rlm = None


def get_rlm():
    """Initialize and return the RLM instance."""
    global _rlm
    if _rlm is not None:
        return _rlm

    try:
        from rlm import RLM
    except ImportError:
        log.warning("rlm package not installed. Install with: pip install rlm")
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        log.error("ANTHROPIC_API_KEY must be set for RLM")
        return None

    # RLM uses OpenAI-compatible backend interface.
    # Anthropic provides messages API - we may need an adapter or compatible endpoint.
    # Try Anthropic's OpenAI-compatible endpoint first, fall back to adapter.
    _rlm = RLM(
        backend="openai",
        backend_kwargs={
            "model_name": os.environ.get("RLM_MODEL", "claude-sonnet-4-5-20250929"),
            "api_key": api_key,
            "base_url": os.environ.get("RLM_BASE_URL", "https://api.anthropic.com/v1/"),
        },
        environment="local",
        max_depth=int(os.environ.get("RLM_MAX_DEPTH", "1")),
        verbose=True,
    )
    log.info("RLM initialized with max_depth=%s", _rlm.max_depth)
    return _rlm


def format_thoughts(thoughts: list[dict]) -> str:
    """Format thoughts into a readable string for the RLM prompt."""
    return "\n".join(
        f"[{i+1}] {t.get('body', '')}" for i, t in enumerate(thoughts)
    )


async def rlm_handle_thought(
    thoughts: list[dict],
    action_thought: dict,
    tool_functions: dict,
) -> Optional[str]:
    """Use RLM to handle a thought with recursive reasoning.

    Args:
        thoughts: Recent thought history
        action_thought: The thought that needs handling
        tool_functions: Dict mapping tool names to their execute functions

    Returns:
        The result string, or None if RLM is not available
    """
    rlm = get_rlm()
    if rlm is None:
        return None

    # Build context with tool functions and thought history
    context = {
        "thoughts": thoughts,
        **tool_functions,
    }

    prompt = f"""You are a thinking agent. Here are your recent thoughts:
{format_thoughts(thoughts)}

Your most recent thought requires action: {action_thought.get('body', '')}

Write Python code to accomplish this. You have access to:
- llm_query(prompt) - recursively call yourself for sub-reasoning
- search_google(query) - search the web
- visit_url(url) - fetch web page content
- run_command(cmd) - run a terminal command
- look_at_terminal() - see terminal output
- send_message(text) - send a Telegram message
- thoughts - list of your recent thoughts

Return your result as the variable `result`."""

    try:
        result = rlm.completion(prompt, context=context)
        return f"observation: {result}"
    except Exception as e:
        log.exception("RLM completion failed")
        return f"observation: RLM reasoning failed: {e}"
