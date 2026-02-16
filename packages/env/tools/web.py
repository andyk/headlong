"""URL fetching with readability extraction."""

import logging

import requests
from readability import Document

log = logging.getLogger(__name__)


async def execute(args: dict) -> str:
    """Fetch a URL and extract the readable text content."""
    url = args.get("url", "")
    log.info("fetching URL: %s", url)

    try:
        response = requests.get(url, timeout=30, headers={
            "User-Agent": "Mozilla/5.0 (compatible; Headlong/1.0)"
        })
        response.raise_for_status()
    except requests.RequestException as e:
        return f"observation: failed to fetch {url}: {e}"

    doc = Document(response.text)
    text = doc.summary()

    # Strip HTML tags from readability output
    from html.parser import HTMLParser
    class TagStripper(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts = []
        def handle_data(self, data):
            self.parts.append(data)
        def get_text(self):
            return "".join(self.parts)

    stripper = TagStripper()
    stripper.feed(text)
    clean_text = stripper.get_text().strip()

    # Truncate if too long
    if len(clean_text) > 10000:
        clean_text = clean_text[:10000] + "\n... (truncated)"

    return f"observation: fetched {url}:\n{clean_text}"


TOOL = {
    "name": "visitURL",
    "description": "Fetch a website. Can be in the form of clicking a link.",
    "parameters": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to fetch, which might be in the form of a link to click",
            },
        },
        "required": ["url"],
    },
    "execute": execute,
}
