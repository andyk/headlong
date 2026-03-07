"""SMS messaging via Twilio.

Supports sending messages (tool) and receiving messages (webhook).
Incoming SMS messages are inserted as thoughts into Supabase.
"""

import os
import asyncio
import logging
from typing import Callable, Awaitable, Optional

from twilio.rest import Client
from twilio.request_validator import RequestValidator
from fastapi import Request, Form, Response

log = logging.getLogger(__name__)

# Webhook callback — set by register_webhook()
_on_message: Optional[Callable[[str, str], Awaitable[None]]] = None


async def execute(args: dict) -> str:
    """Send an SMS via Twilio."""
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
    from_number = os.environ.get("TWILIO_PHONE_NUMBER")

    if not account_sid or not auth_token:
        return "observation: TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set"
    if not from_number:
        return "observation: TWILIO_PHONE_NUMBER not set"

    to = args.get("to")
    body = args.get("body", "")

    if not to:
        return "observation: 'to' phone number is required"

    log.info("sending SMS to %s: %s", to, body[:100])

    loop = asyncio.get_running_loop()
    client = Client(account_sid, auth_token)
    message = await loop.run_in_executor(
        None,
        lambda: client.messages.create(body=body, from_=from_number, to=to),
    )

    return f"observation: sent SMS to {to} (sid: {message.sid}) with body:\n{body}"


def register_webhook(app, on_message: Callable[[str, str], Awaitable[None]]):
    """Register the /sms/webhook endpoint on the FastAPI app.

    Args:
        app: FastAPI application instance.
        on_message: async callback(from_number, text) called for each incoming SMS.
    """
    global _on_message
    _on_message = on_message

    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")

    @app.post("/sms/webhook")
    async def sms_webhook(request: Request):
        form = await request.form()
        from_number = form.get("From", "")
        body = form.get("Body", "")

        # Validate the request is actually from Twilio
        if auth_token:
            validator = RequestValidator(auth_token)
            sig = request.headers.get("X-Twilio-Signature", "")
            url = str(request.url)
            params = dict(form)
            if not validator.validate(url, params, sig):
                log.warning("SMS webhook: invalid Twilio signature")
                return Response(content="<Response/>", media_type="application/xml", status_code=403)

        log.info("SMS webhook received from %s: %s", from_number, body[:100])

        if _on_message:
            await _on_message(
                from_number,
                f"observation: received SMS from {from_number}: {body}",
            )

        # Return empty TwiML so Twilio doesn't retry
        return Response(content="<Response/>", media_type="application/xml")

    log.info("SMS webhook registered at /sms/webhook")


TOOL = {
    "name": "sendSMS",
    "description": "Send an SMS text message via Twilio.",
    "parameters": {
        "type": "object",
        "properties": {
            "body": {
                "type": "string",
                "description": "The message to send",
            },
            "to": {
                "type": "string",
                "description": "The phone number to send to (E.164 format, e.g. +15551234567)",
            },
        },
        "required": ["body", "to"],
    },
    "execute": execute,
}
