"""Claude LLM wrapper for thought generation (agent daemon)."""

import os
import logging
from typing import Optional, Callable

import anthropic

import repl as repl_module

log = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-sonnet-4-5-20250929"
DEFAULT_MAX_TOKENS = 1024
DEFAULT_TEMPERATURE = 0.5
RLM_MAX_TOKENS = 4096

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


async def stream_completion(
    system_message: str,
    user_message: str,
    assistant_messages: list[str],
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    temperature: float = DEFAULT_TEMPERATURE,
):
    """Stream a completion from Claude for thought generation.

    Yields text chunks as they arrive.
    """
    client = get_client()

    # Build messages in the prompted thought stream format
    messages = []
    messages.append({"role": "user", "content": user_message})
    for msg in assistant_messages:
        if msg:
            messages.append({"role": "assistant", "content": msg})
            messages.append({"role": "user", "content": user_message})

    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system_message,
        messages=messages,
    ) as stream:
        for text in stream.text_stream:
            yield text


async def run_rlm_loop(
    system_prompt: str,
    agent_name: str,
    model: str = DEFAULT_MODEL,
    max_tokens: int = RLM_MAX_TOKENS,
    temperature: float = DEFAULT_TEMPERATURE,
    max_iterations: int = 10,
    on_step: Optional[Callable[[str], None]] = None,
) -> str:
    """Run the RLM loop: Claude gets a REPL and iterates until FINAL().

    Returns the final thought text.
    """
    import llm as llm_self  # self-reference for passing to namespace

    client = get_client()
    namespace, final = repl_module.create_repl_namespace(agent_name, llm_self)

    messages = [{"role": "user", "content": "Generate the next thought."}]

    for iteration in range(max_iterations):
        if on_step:
            on_step(f"RLM iteration {iteration + 1}/{max_iterations}")

        log.info("RLM iteration %d for agent=%s", iteration + 1, agent_name)

        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=messages,
        )

        assistant_text = response.content[0].text
        messages.append({"role": "assistant", "content": assistant_text})

        # Extract REPL blocks
        blocks = repl_module.extract_repl_blocks(assistant_text)

        if not blocks:
            # No REPL blocks — treat the entire response as the thought (graceful fallback)
            log.info("RLM: no repl blocks found, using response as thought")
            if on_step:
                on_step("No REPL blocks, using response directly")
            return assistant_text.strip()

        # Execute each block
        all_output = []
        for i, code in enumerate(blocks):
            log.debug("RLM: executing block %d:\n%s", i + 1, code[:200])
            output = repl_module.execute_repl_block(code, namespace)
            if output:
                log.info("RLM: block %d output:\n%s", i + 1, output[:500])
                all_output.append(output)
            if final.is_set:
                log.info("RLM: FINAL called after block %d", i + 1)
                if on_step:
                    on_step(f"FINAL called — thought produced")
                return final.value

        # Feed output back to Claude for next iteration
        combined_output = "\n".join(all_output) if all_output else "(no output)"
        log.info("RLM: combined REPL output:\n%s", combined_output[:1000])
        messages.append({"role": "user", "content": f"REPL output:\n{combined_output}"})

    # Max iterations reached — return whatever prose Claude produced last
    log.warning("RLM: max iterations (%d) reached for agent=%s", max_iterations, agent_name)
    if on_step:
        on_step(f"Max iterations reached")
    # Return the last assistant message as fallback
    return messages[-2]["content"].strip() if len(messages) >= 2 else ""
