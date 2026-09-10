"""Posts a message to a Microsoft Teams channel via the "When a Teams webhook
request is received" trigger (Microsoft's own connector docs at
https://learn.microsoft.com/en-us/connectors/teams/, operation ID
TeamsIncomingWebhookTrigger).

That trigger only accepts two request-body shapes: an array of Adaptive Cards,
or a legacy MessageCard. We send the former -- {"type": "message",
"attachments": [{"contentType": "application/vnd.microsoft.card.adaptive",
"contentUrl": null, "content": <adaptive card>}]} -- since it's the
documented, non-deprecated shape.
"""

import httpx

ADAPTIVE_CARD_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json"


class TeamsNotifyError(RuntimeError):
    pass


def notify(webhook_url: str, title: str, lines: list[str], action_url: str | None = None, action_title: str = "Open in Maps") -> None:
    if not webhook_url:
        raise TeamsNotifyError("Teams webhook URL is not configured")

    body = [{"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True}]
    body += [{"type": "TextBlock", "text": line, "wrap": True} for line in lines]

    card = {
        "$schema": ADAPTIVE_CARD_SCHEMA,
        "type": "AdaptiveCard",
        "version": "1.2",
        "body": body,
    }
    if action_url:
        card["actions"] = [{"type": "Action.OpenUrl", "title": action_title, "url": action_url}]

    payload = {
        "type": "message",
        "attachments": [
            {"contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": None, "content": card}
        ],
    }

    with httpx.Client(timeout=10.0) as client:
        resp = client.post(webhook_url, json=payload)
        if resp.status_code >= 300:
            raise TeamsNotifyError(f"Teams webhook error: {resp.status_code} - {resp.text}")
