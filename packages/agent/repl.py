"""REPL executor for the RLM (Recursive Language Model) architecture.

Provides a sandboxed Python REPL namespace with database access, sub-LLM calls,
embedding/vector search, and the FINAL mechanism for producing thoughts.
"""

import os
import re
import logging
import traceback
import threading
from io import StringIO
from contextlib import redirect_stdout
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)

REPL_TIMEOUT_SECONDS = 30


class _FinalResult:
    """Sentinel for capturing the agent's final thought output."""

    def __init__(self):
        self.is_set = False
        self.value = None

    def FINAL(self, text: str):
        """Set the final thought text directly."""
        self.value = str(text)
        self.is_set = True

    def FINAL_VAR(self, var_name: str, namespace: dict):
        """Set the final thought from a variable in the REPL namespace."""
        if var_name not in namespace:
            raise NameError(f"Variable '{var_name}' not found in namespace")
        self.value = str(namespace[var_name])
        self.is_set = True


def extract_repl_blocks(text: str) -> list[str]:
    """Extract ```repl code blocks from Claude's response."""
    pattern = r"```repl\s*\n(.*?)```"
    return re.findall(pattern, text, re.DOTALL)


def execute_repl_block(code: str, namespace: dict) -> str:
    """Execute a code block in the given namespace, capturing stdout.

    Returns the captured output or traceback string.
    Enforces a timeout via ThreadPoolExecutor (works from any thread).
    """
    buf = StringIO()

    def _run():
        with redirect_stdout(buf):
            exec(code, namespace)  # noqa: S102

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_run)
            future.result(timeout=REPL_TIMEOUT_SECONDS)
    except FuturesTimeoutError:
        buf.write(f"\n[ERROR] REPL block timed out after {REPL_TIMEOUT_SECONDS}s\n")
    except Exception:
        buf.write(traceback.format_exc())

    return buf.getvalue()


def _get_repl_connection():
    """Get a psycopg2 connection using the restricted agent_repl role."""
    dsn = os.environ.get("AGENT_REPL_DB_URL")
    if not dsn:
        raise RuntimeError("AGENT_REPL_DB_URL must be set")
    return psycopg2.connect(dsn)


def create_repl_namespace(agent_name: str, llm_module) -> tuple[dict, _FinalResult]:
    """Build the REPL namespace with database, LLM, and embedding helpers.

    Returns (namespace_dict, final_result_sentinel).
    """
    final = _FinalResult()
    conn = _get_repl_connection()
    conn.autocommit = True

    def sql(query: str, params=None):
        """Execute raw SQL via the restricted agent_repl connection.

        SELECT queries return a list of dicts.
        INSERT/UPDATE/DELETE return the rowcount.
        """
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params)
            if cur.description is not None:
                return [dict(row) for row in cur.fetchall()]
            return cur.rowcount

    def llm_query(prompt: str, max_tokens: int = 1024) -> str:
        """Call a sub-LLM for analysis/summarization."""
        client = llm_module.get_client()
        response = client.messages.create(
            model=llm_module.DEFAULT_MODEL,
            max_tokens=max_tokens,
            temperature=0.3,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

    def embed(text: str) -> list[float]:
        """Get embedding vector via OpenAI text-embedding-3-small."""
        from openai import OpenAI
        oai = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        response = oai.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )
        return response.data[0].embedding

    def vector_search(query_text: str, limit: int = 10) -> list[dict]:
        """Embed query text and search memories by cosine similarity."""
        query_embedding = embed(query_text)
        return sql(
            "SELECT id, agent_name, body, metadata, created_at "
            "FROM memories WHERE agent_name = %s "
            "ORDER BY embedding <=> %s::vector LIMIT %s",
            [agent_name, str(query_embedding), limit],
        )

    # Restricted builtins — block filesystem and dynamic code execution
    safe_builtins = {
        k: v for k, v in __builtins__.items()
        if k not in (
            "open", "__import__", "eval", "exec", "compile",
            "breakpoint", "exit", "quit",
        )
    } if isinstance(__builtins__, dict) else {
        k: getattr(__builtins__, k) for k in dir(__builtins__)
        if k not in (
            "open", "__import__", "eval", "exec", "compile",
            "breakpoint", "exit", "quit",
        ) and not k.startswith("_")
    }

    namespace = {
        "__builtins__": safe_builtins,
        "agent_name": agent_name,
        "sql": sql,
        "llm_query": llm_query,
        "embed": embed,
        "vector_search": vector_search,
        "FINAL": final.FINAL,
        "FINAL_VAR": lambda var_name: final.FINAL_VAR(var_name, namespace),
        "print": print,  # will be captured by redirect_stdout
    }

    return namespace, final
