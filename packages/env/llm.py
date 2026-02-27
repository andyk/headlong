"""Claude LLM wrapper using the Anthropic SDK."""

import os
import logging
from typing import Optional

import anthropic

log = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-sonnet-4-5-20250929"
DEFAULT_MAX_TOKENS = 1024
DEFAULT_TEMPERATURE = 0.5

_client: Optional[anthropic.Anthropic] = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is not None:
        return _client
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY must be set")
    _client = anthropic.Anthropic(api_key=api_key)
    return _client


_env_system_prompt: str = ""


def set_env_system_prompt(prompt: str) -> None:
    """Set the base system prompt fetched from Supabase."""
    global _env_system_prompt
    _env_system_prompt = prompt


def build_system_prompt(tool_descriptions: list[str]) -> str:
    """Build the system prompt with available tool descriptions.

    Uses the base prompt from Supabase (or a default fallback)
    and appends the available tools list.
    """
    tools_list = "\n".join(f"- {desc}" for desc in tool_descriptions)
    base = _env_system_prompt or (
        "Your job is to consider your recent thoughts and then take an action.\n"
        "The way you take action is by calling one of the available tools with appropriate arguments.\n"
        "If you don't think any tool is appropriate for this action, respond with text starting with "
        "\"observation: \" explaining what you observe or that you don't know how to do that.\n"
        "When deciding what action to take, use the following stream of recent thoughts for context."
    )
    return f"""{base}

Available tools:
{tools_list}"""


def build_messages(thoughts: list[dict]) -> list[dict]:
    """Convert thought history into Claude messages format.

    Thoughts are placed as context in the conversation. The last thought
    (the action to handle) becomes the final user message.
    """
    if not thoughts:
        raise ValueError("thoughts must have at least one thought")

    # Build thought context string from all but the last thought
    context_thoughts = thoughts[:-1]
    thought_context = "\n".join(t["body"] for t in context_thoughts)

    # The last thought is the action to handle
    action_thought = thoughts[-1]

    messages = []
    if thought_context:
        messages.append({
            "role": "user",
            "content": f"Here are my recent thoughts:\n\n{thought_context}",
        })
        messages.append({
            "role": "assistant",
            "content": "I've reviewed your recent thoughts. What action should I take?",
        })
    messages.append({
        "role": "user",
        "content": f"I need to take action on this thought: {action_thought['body']}",
    })

    return messages


def generate_action(
    thoughts: list[dict],
    tools: list[dict],
    tool_descriptions: list[str],
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    temperature: float = DEFAULT_TEMPERATURE,
) -> dict:
    """Send thought context + tools to Claude and get back either text or a tool call.

    Returns:
        dict with either:
            {"type": "text", "content": "..."} or
            {"type": "tool_use", "name": "...", "args": {...}}
    """
    client = get_client()
    system = build_system_prompt(tool_descriptions)
    messages = build_messages(thoughts)

    log.info("calling Claude (%s) with %d thoughts, %d tools", model, len(thoughts), len(tools))
    log.debug("messages: %s", messages)

    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=messages,
        tools=tools,
    )

    log.info("Claude response stop_reason: %s", response.stop_reason)

    # Parse response — prioritize tool_use over text.
    # Claude often returns [text, tool_use] where the text is just preamble.
    tool_block = None
    text_block = None
    for block in response.content:
        if block.type == "tool_use" and tool_block is None:
            tool_block = block
        elif block.type == "text" and text_block is None:
            text_block = block

    if tool_block is not None:
        log.info("Claude called tool: %s with args: %s", tool_block.name, tool_block.input)
        return {"type": "tool_use", "name": tool_block.name, "args": tool_block.input}
    elif text_block is not None:
        log.info("Claude returned text: %s", text_block.text[:200])
        return {"type": "text", "content": text_block.text}

    return {"type": "text", "content": "observation: no response from Claude"}
