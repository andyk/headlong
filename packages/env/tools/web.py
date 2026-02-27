"""URL fetching via Playwright headless Chromium browser."""

import logging
from playwright.async_api import async_playwright, Browser, BrowserContext

log = logging.getLogger(__name__)

# Persistent browser instance — launched on first use, reused across requests.
_playwright = None
_browser: Browser | None = None
_context: BrowserContext | None = None


async def _get_context() -> BrowserContext:
    """Lazily launch Chromium and return a reusable browser context."""
    global _playwright, _browser, _context
    if _context is not None:
        return _context
    _playwright = await async_playwright().start()
    _browser = await _playwright.chromium.launch(headless=True)
    _context = await _browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 900},
        java_script_enabled=True,
    )
    return _context


async def execute(args: dict) -> str:
    """Fetch a URL with a real headless browser and extract text content."""
    url = args.get("url", "")
    log.info("fetching URL via Playwright: %s", url)

    try:
        ctx = await _get_context()
        page = await ctx.new_page()
        try:
            response = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            if response and response.status >= 400:
                return f"observation: failed to fetch {url}: HTTP {response.status}"

            # Wait briefly for JS-rendered content to settle
            await page.wait_for_timeout(1500)

            # Extract readable text — prefer article/main, fall back to body
            clean_text = await page.evaluate("""() => {
                // Remove script, style, nav, header, footer noise
                for (const el of document.querySelectorAll('script, style, nav, footer, header, aside, [role="banner"], [role="navigation"]')) {
                    el.remove();
                }
                const article = document.querySelector('article') || document.querySelector('main') || document.body;
                return article.innerText;
            }""")

            clean_text = clean_text.strip()
            if not clean_text:
                clean_text = await page.inner_text("body")
                clean_text = clean_text.strip()

        finally:
            await page.close()

    except Exception as e:
        log.error("Playwright fetch failed for %s: %s", url, e)
        return f"observation: failed to fetch {url}: {e}"

    # Truncate if too long
    if len(clean_text) > 10000:
        clean_text = clean_text[:10000] + "\n... (truncated)"

    return f"observation: fetched {url}:\n{clean_text}"


TOOL = {
    "name": "visitURL",
    "description": "Fetch a website using a real browser. Can be in the form of clicking a link.",
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
