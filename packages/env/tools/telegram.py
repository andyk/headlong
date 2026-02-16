"""Telegram messaging (replaces Twilio SMS).

Supports both sending messages (tool) and receiving messages (polling listener).
Incoming Telegram messages are inserted as thoughts into Supabase.
"""

import os
import logging
from typing import Callable, Awaitable, Optional

import telegram
from telegram.ext import ApplicationBuilder, MessageHandler, filters

log = logging.getLogger(__name__)


async def execute(args: dict) -> str:
    """Send a Telegram message."""
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = args.get("chat_id") or os.environ.get("TELEGRAM_CHAT_ID")

    if not bot_token:
        return "observation: TELEGRAM_BOT_TOKEN not set"
    if not chat_id:
        return "observation: no chat_id provided and TELEGRAM_CHAT_ID not set"

    body = args.get("body", "")
    log.info("sending Telegram message to %s: %s", chat_id, body[:100])

    bot = telegram.Bot(token=bot_token)
    await bot.send_message(chat_id=chat_id, text=body)

    return f"observation: sent Telegram message to {chat_id} with body:\n{body}"


_app: Optional[telegram.ext.Application] = None


async def start_listener(on_message: Callable[[str, str], Awaitable[None]]):
    """Start polling for incoming Telegram messages.

    Args:
        on_message: async callback(chat_id, text) called for each incoming message.
    """
    global _app
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not bot_token:
        log.warning("TELEGRAM_BOT_TOKEN not set, skipping Telegram listener")
        return

    _app = ApplicationBuilder().token(bot_token).build()

    async def handle_message(update: telegram.Update, context):
        if update.message and update.message.text:
            chat_id = str(update.message.chat_id)
            text = update.message.text
            sender = update.message.from_user
            sender_name = sender.first_name if sender else "unknown"
            log.info("received Telegram message from %s (chat %s): %s", sender_name, chat_id, text[:100])
            await on_message(chat_id, f"observation: received Telegram message from {sender_name}: {text}")

    _app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    await _app.initialize()
    await _app.start()
    await _app.updater.start_polling(drop_pending_updates=True)
    log.info("Telegram bot listener started (polling)")


async def stop_listener():
    """Stop the Telegram polling listener."""
    global _app
    if _app:
        await _app.updater.stop()
        await _app.stop()
        await _app.shutdown()
        _app = None


TOOL = {
    "name": "sendMessage",
    "description": "Send a message via Telegram.",
    "parameters": {
        "type": "object",
        "properties": {
            "body": {
                "type": "string",
                "description": "The message to send",
            },
            "chat_id": {
                "type": "string",
                "description": "The Telegram chat ID to send to (defaults to TELEGRAM_CHAT_ID env var)",
            },
        },
        "required": ["body"],
    },
    "execute": execute,
}
