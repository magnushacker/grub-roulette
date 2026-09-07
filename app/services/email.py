"""Thin client for sending transactional email via the Resend API."""

import html

import httpx

from app.config import settings

RESEND_URL = "https://api.resend.com/emails"


class EmailError(RuntimeError):
    pass


def send_verification_email(to_email: str, display_name: str, verify_url: str) -> None:
    if not settings.resend_api_key:
        # No Resend account configured (e.g. local dev) -- print the link
        # instead of failing, so the signup flow is still testable.
        print(f"[email] RESEND_API_KEY not set; verification link for {to_email}: {verify_url}")
        return

    safe_name = html.escape(display_name)
    body = {
        "from": settings.email_from,
        "to": [to_email],
        "subject": "Verify your Grub Roulette account",
        "html": (
            f"<p>Hi {safe_name},</p>"
            "<p>Click the link below to verify your email and activate your Grub Roulette account:</p>"
            f'<p><a href="{verify_url}">{verify_url}</a></p>'
        ),
    }
    headers = {"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(RESEND_URL, json=body, headers=headers)
        if resp.status_code >= 300:
            raise EmailError(f"Resend error: {resp.status_code} - {resp.text}")
