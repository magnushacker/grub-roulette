"""Posts a message to a Microsoft Teams channel via a generic webhook (e.g. a
Power Automate flow triggered by "When a Teams webhook request is received").

The exact JSON shape a given flow expects depends on how its trigger was set
up, so this sends both a ready-to-post "text" field and the raw structured
fields -- whichever the flow's actions pick up.
"""

import httpx


class TeamsNotifyError(RuntimeError):
    pass


def notify(webhook_url: str, payload: dict) -> None:
    if not webhook_url:
        raise TeamsNotifyError("Teams webhook URL is not configured")

    with httpx.Client(timeout=10.0) as client:
        resp = client.post(webhook_url, json=payload)
        if resp.status_code >= 300:
            raise TeamsNotifyError(f"Teams webhook error: {resp.status_code} - {resp.text}")
