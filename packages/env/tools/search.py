"""Google search via SerpAPI."""

import os
import logging

from serpapi import GoogleSearch

log = logging.getLogger(__name__)


async def execute(args: dict) -> str:
    """Search Google and return top 5 results."""
    api_key = os.environ.get("SERPAPI_API_KEY")
    if not api_key:
        return "observation: SERPAPI_API_KEY not set"

    query = args.get("query", "")
    log.info("searching Google for: %s", query)

    search = GoogleSearch({
        "api_key": api_key,
        "engine": "google",
        "q": query,
        "google_domain": "google.com",
        "gl": "us",
        "hl": "en",
    })
    results = search.get_dict()
    organic = results.get("organic_results", [])[:5]

    formatted = f"observation: search results for query '{query}':\n\n"
    formatted += "\n\n".join(
        f"title: {r.get('title', '')}\nlink: {r.get('link', '')}\nsnippet: {r.get('snippet', '')}"
        for r in organic
    )
    return formatted


TOOL = {
    "name": "searchGoogle",
    "description": "Google search, also known as web search, or just search. Use this to look up things.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The string to search for in Google",
            },
        },
        "required": ["query"],
    },
    "execute": execute,
}
