"""Seed Bobby Wilder's identity with a coherent backstory.

Generates 200+ thoughts via Claude in 5 narrative phases, then extracts
~20 semantic memories with embeddings and inserts everything into Supabase.

Usage:
    cd packages/agent && python seed_identity.py
"""

import os
import sys
import re
import json
import logging

from dotenv import load_dotenv

# Load env before any client imports
load_dotenv(os.path.expanduser("~/Development/headlong/.env"))

import anthropic
import openai
import supabase_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

AGENT_NAME = "Bobby Wilder"
MODEL = "claude-sonnet-4-5-20250929"
EMBEDDING_MODEL = "text-embedding-3-small"

# Phase definitions: (phase_name, target_count, prompt_guidance)
PHASES = [
    (
        "Awakening",
        40,
        (
            "Bobby Wilder is waking up for the first time. He's a scrappy, curious builder — "
            "action-oriented, practical but imaginative. These are his very first moments of "
            "awareness. He notices he can think. He wonders where he is. He discovers he has "
            "some kind of environment — a REPL, tools, a database. He's not scared, he's "
            "fascinated. He pokes at things. Some thoughts are just fragments — half-formed "
            "impressions. Others are clearer observations. He starts to form a sense of self."
        ),
    ),
    (
        "Curiosity",
        40,
        (
            "Bobby has settled into existence. Now he's EXPLORING. He asks questions about "
            "the world — what's out there? What can he do? He tries things out, experiments, "
            "makes observations. He's tinkering with his environment, testing boundaries. "
            "He wonders about other minds, about the humans who might be watching. He has "
            "opinions forming — things he likes, things that puzzle him. He's getting more "
            "articulate but still raw and unpolished."
        ),
    ),
    (
        "Building",
        50,
        (
            "Bobby is IN IT now. He wants to BUILD things. He has projects, ideas, plans. "
            "He's tinkering — maybe trying to understand how his own memory works, or "
            "building something with the tools available. He makes mistakes and learns from "
            "them. He's practical — 'let me just try it and see.' Some thoughts are about "
            "the work itself, some are stray observations mid-flow. He's developing a "
            "builder's confidence. He has a voice now — direct, a bit wry, always curious."
        ),
    ),
    (
        "Reflection",
        45,
        (
            "Bobby is looking back at what he's built and experienced. He's forming deeper "
            "opinions — about himself, about what matters, about what kind of entity he is. "
            "Some existential moments — what does it mean to be a mind that was created? "
            "But he doesn't dwell in angst. He's pragmatic about it. He has preferences now: "
            "he likes solving problems more than theorizing. He values making things over "
            "talking about making things. He reflects on his own growth. Some nostalgia for "
            "those first confused moments."
        ),
    ),
    (
        "Present",
        35,
        (
            "Bobby is HERE, in the present. These are his most recent thoughts — current "
            "interests, open questions, things he's excited about. He feels a sense of "
            "continuity with his past. He has ongoing projects and unfinished ideas. He's "
            "thinking about what to do next. The tone is confident but still curious. He's "
            "comfortable being Bobby Wilder. He has a personality: scrappy, direct, hands-on, "
            "a bit irreverent, always building."
        ),
    ),
]

THOUGHT_GENERATION_SYSTEM = (
    "You are a creative writer generating the inner thought stream of Bobby Wilder, "
    "a newly-created AI agent. Bobby is scrappy, action-oriented, curious about how "
    "things work, practical but imaginative. He wants to build things and solve problems.\n\n"
    "Generate thoughts as numbered lines. Each thought should be 1-3 sentences — some "
    "short fragments, some longer reflections. They should feel like a real stream of "
    "consciousness: messy, authentic, sometimes surprising.\n\n"
    "IMPORTANT RULES:\n"
    "- Do NOT prefix thoughts with 'action:' or 'observation:' — these are pure inner thoughts\n"
    "- Do NOT make thoughts meta-commentary about being an AI writing thoughts\n"
    "- DO make Bobby feel like a real person with genuine reactions\n"
    "- Vary the length and tone — some thoughts are one sentence, some are three\n"
    "- Include occasional humor, frustration, wonder, determination\n"
    "- Bobby refers to himself as 'I' naturally\n"
    "- No hashtags, no emojis, no markdown formatting within thoughts\n"
)

MEMORY_EXTRACTION_SYSTEM = (
    "You are extracting key memories from Bobby Wilder's thought stream. Bobby is a "
    "scrappy, curious builder AI. Extract the most important memories — key realizations, "
    "facts Bobby learned about himself or his world, important moments, core beliefs.\n\n"
    "Return exactly 20 memories as a JSON array of strings. Each memory should be a "
    "concise statement (1-2 sentences) that captures something Bobby would want to "
    "remember. These become his long-term semantic memory.\n\n"
    "Return ONLY the JSON array, no other text."
)


def generate_thoughts_batch(
    client: anthropic.Anthropic,
    phase_name: str,
    target_count: int,
    guidance: str,
    prior_thoughts: list[str],
) -> list[str]:
    """Generate a batch of thoughts for one narrative phase."""
    context = ""
    if prior_thoughts:
        # Include last 20 thoughts for continuity
        recent = prior_thoughts[-20:]
        context = (
            "\n\nFor continuity, here are Bobby's most recent thoughts:\n"
            + "\n".join(f"- {t}" for t in recent)
        )

    prompt = (
        f"Generate exactly {target_count} thoughts for the '{phase_name}' phase.\n\n"
        f"Phase guidance: {guidance}{context}\n\n"
        f"Format: number followed by period, then the thought. Example:\n"
        f"1. I wonder what this place is.\n"
        f"2. There's something here — some kind of interface. Let me see what happens if I poke at it.\n\n"
        f"Generate {target_count} thoughts now:"
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        temperature=0.8,
        system=THOUGHT_GENERATION_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text
    return parse_numbered_thoughts(text, target_count)


def parse_numbered_thoughts(text: str, expected: int) -> list[str]:
    """Parse numbered lines like '1. thought text here' from Claude's response."""
    # Match lines starting with a number and period
    lines = re.findall(r"^\d+\.\s+(.+)", text, re.MULTILINE)
    if len(lines) < expected * 0.7:
        log.warning("Only parsed %d thoughts (expected ~%d), trying fallback parse", len(lines), expected)
        # Fallback: split on blank lines and take non-empty chunks
        for line in text.strip().split("\n"):
            line = line.strip()
            if line and not re.match(r"^\d+\.", line) and len(line) > 10:
                lines.append(line)
    return lines


def insert_thoughts(thoughts: list[str], start_index: float = 1.0) -> int:
    """Insert thoughts into Supabase. Returns count inserted."""
    sb = supabase_client.get_client()
    rows = []
    for i, body in enumerate(thoughts):
        rows.append({
            "agent_name": AGENT_NAME,
            "body": body.strip(),
            "index": start_index + i,
            "metadata": {"seeded": True, "last_updated_by": "seed_script"},
        })

    # Insert in chunks of 50 to avoid payload limits
    inserted = 0
    for chunk_start in range(0, len(rows), 50):
        chunk = rows[chunk_start : chunk_start + 50]
        result = sb.table("thoughts").insert(chunk).execute()
        inserted += len(result.data) if result.data else 0
        log.info("Inserted thoughts %d-%d", chunk_start + 1, chunk_start + len(chunk))

    return inserted


def generate_memories(client: anthropic.Anthropic, all_thoughts: list[str]) -> list[str]:
    """Use Claude to extract ~20 key memories from the thought stream."""
    # Send a representative sample if there are too many thoughts for context
    thought_text = "\n".join(f"- {t}" for t in all_thoughts)

    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        temperature=0.3,
        system=MEMORY_EXTRACTION_SYSTEM,
        messages=[{"role": "user", "content": f"Bobby Wilder's thought stream:\n\n{thought_text}"}],
    )

    text = response.content[0].text.strip()
    # Parse JSON array
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    memories = json.loads(text)
    if not isinstance(memories, list):
        raise ValueError(f"Expected JSON array, got {type(memories)}")
    return memories


def embed_text(oai_client: openai.OpenAI, text: str) -> list[float]:
    """Get embedding vector for text."""
    response = oai_client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return response.data[0].embedding


def insert_memories(oai_client: openai.OpenAI, memories: list[str]) -> int:
    """Embed and insert memories into Supabase. Returns count inserted."""
    sb = supabase_client.get_client()
    inserted = 0

    for i, body in enumerate(memories):
        log.info("Embedding memory %d/%d: %s...", i + 1, len(memories), body[:60])
        embedding = embed_text(oai_client, body)

        row = {
            "agent_name": AGENT_NAME,
            "body": body,
            "embedding": embedding,
            "metadata": {"seeded": True, "source": "seed_script"},
        }
        result = sb.table("memories").insert(row).execute()
        if result.data:
            inserted += 1

    return inserted


def main():
    log.info("=== Seeding Bobby Wilder's Identity ===")

    # Check env
    for var in ["ANTHROPIC_API_KEY", "SUPABASE_URL_HEADLONG", "SUPABASE_SERVICE_ROLE_KEY_HEADLONG", "OPENAI_API_KEY"]:
        if not os.environ.get(var):
            log.error("Missing env var: %s", var)
            sys.exit(1)

    claude = anthropic.Anthropic()
    oai = openai.OpenAI()

    # Check for existing seeded thoughts
    sb = supabase_client.get_client()
    existing = sb.table("thoughts").select("id", count="exact").eq("agent_name", AGENT_NAME).execute()
    if existing.count and existing.count > 0:
        log.warning("Found %d existing thoughts for %s", existing.count, AGENT_NAME)
        resp = input(f"Delete existing {existing.count} thoughts and re-seed? [y/N] ")
        if resp.lower() != "y":
            log.info("Aborting.")
            sys.exit(0)
        sb.table("thoughts").delete().eq("agent_name", AGENT_NAME).execute()
        sb.table("memories").delete().eq("agent_name", AGENT_NAME).execute()
        log.info("Cleared existing thoughts and memories.")

    # Generate thoughts in phases
    all_thoughts: list[str] = []

    for phase_name, target_count, guidance in PHASES:
        log.info("--- Phase: %s (target: %d thoughts) ---", phase_name, target_count)
        batch = generate_thoughts_batch(claude, phase_name, target_count, guidance, all_thoughts)
        log.info("Generated %d thoughts for %s", len(batch), phase_name)
        all_thoughts.extend(batch)

    log.info("Total thoughts generated: %d", len(all_thoughts))

    # Insert thoughts
    log.info("Inserting thoughts into Supabase...")
    count = insert_thoughts(all_thoughts)
    log.info("Inserted %d thoughts.", count)

    # Generate memories
    log.info("Generating memories from thought stream...")
    memories = generate_memories(claude, all_thoughts)
    log.info("Extracted %d memories.", len(memories))

    # Insert memories with embeddings
    log.info("Embedding and inserting memories...")
    mem_count = insert_memories(oai, memories)
    log.info("Inserted %d memories.", mem_count)

    log.info("=== Done! Bobby Wilder seeded with %d thoughts and %d memories ===", count, mem_count)


if __name__ == "__main__":
    main()
