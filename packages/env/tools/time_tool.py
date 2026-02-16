"""Current time tool."""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)


async def execute(args: dict) -> str:
    """Get the current time in a specified timezone."""
    timezone = args.get("timezone", "America/Los_Angeles")

    try:
        tz = ZoneInfo(timezone)
    except Exception:
        tz = ZoneInfo("America/Los_Angeles")

    now = datetime.now(tz)
    formatted = now.strftime("%A, %B %d, %Y %I:%M:%S %p %Z")
    return f"observation: it's {formatted}"


TOOL = {
    "name": "checkTime",
    "description": "See what time it is, could be looking at a watch or a clock.",
    "parameters": {
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": "The timezone. Default is 'America/Los_Angeles'",
            },
        },
    },
    "execute": execute,
}
