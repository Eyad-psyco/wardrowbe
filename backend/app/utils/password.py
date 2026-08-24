"""Password hashing for local accounts (users who do not sign in via OIDC)."""

import bcrypt

MIN_PASSWORD_LENGTH = 5
# bcrypt hashes at most 72 bytes and silently ignores the rest, so a longer
# password would authenticate against any string sharing its first 72 bytes.
# Reject instead of quietly truncating.
MAX_PASSWORD_BYTES = 72


class PasswordPolicyError(ValueError):
    """Raised when a password cannot be used as-is."""


def validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise PasswordPolicyError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters long."
        )
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise PasswordPolicyError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes long.")


def hash_password(password: str) -> str:
    validate_password(password)
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str | None) -> bool:
    """Constant-time check. False for users with no password set (OIDC-only)."""
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        # Malformed stored hash — treat as no match rather than a 500.
        return False
