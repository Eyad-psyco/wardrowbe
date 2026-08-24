"""Signup invite tokens.

An invite is a short-lived JWT signed with SECRET_KEY that names exactly one
email address. There is deliberately no invites table: because `users.email` is
unique, a token can only ever create the one account it names, so replaying it
fails on the unique constraint rather than minting extra accounts.

ponytail: no revocation list. A leaked, unexpired invite can still create the
one account it names, and the only way to kill it early is rotating SECRET_KEY.
If you need revocation or per-invite auditing, add a signup_invites table with
a used_at column and check it here.
"""

from datetime import UTC, datetime, timedelta

import jwt

from app.config import get_settings

INVITE_AUDIENCE = "wardrowbe:signup-invite"
DEFAULT_INVITE_TTL = timedelta(days=7)


class InviteError(ValueError):
    """Raised when an invite token is missing, malformed, or expired."""


def create_invite_token(email: str, ttl: timedelta | None = None) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": email.strip().lower(),
        "aud": INVITE_AUDIENCE,
        "iat": now,
        "exp": now + (ttl or DEFAULT_INVITE_TTL),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def read_invite_token(token: str) -> str:
    """Return the invited email, or raise InviteError."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"],
            audience=INVITE_AUDIENCE,
            options={"require": ["exp", "sub", "aud"]},
        )
    except jwt.PyJWTError as e:
        raise InviteError("Invite is invalid or has expired.") from e

    email = (payload.get("sub") or "").strip().lower()
    if not email:
        raise InviteError("Invite is invalid or has expired.")
    return email
