#!/usr/bin/env python
"""Create local accounts, reset passwords, and mint signup invites.

There is no open signup, so the first account has to be made here:

    docker compose exec backend python scripts/manage_users.py \
        create you@example.com --display-name "You"
    docker compose exec backend python scripts/manage_users.py \
        set-password you@example.com
    docker compose exec backend python scripts/manage_users.py \
        invite someone@example.com

Passwords are prompted for, never passed as arguments, so they stay out of the
shell history and the process list.
"""

import argparse
import asyncio
import getpass
import sys
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.database import async_session_maker  # noqa: E402
from app.models.user import User  # noqa: E402
from app.utils.invite import create_invite_token  # noqa: E402
from app.utils.password import PasswordPolicyError, hash_password  # noqa: E402


def _prompt_password() -> str:
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Confirm password: "):
        raise SystemExit("Passwords do not match.")
    return password


async def _get_user(session, email: str) -> User | None:
    result = await session.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create(email: str, display_name: str) -> None:
    password_hash = hash_password(_prompt_password())
    async with async_session_maker() as session:
        if await _get_user(session, email):
            raise SystemExit(f"A user already exists for {email}.")
        session.add(
            User(
                external_id=f"local:{uuid4()}",
                email=email,
                display_name=display_name,
                password_hash=password_hash,
            )
        )
        await session.commit()
    print(f"Created {email}.")


async def set_password(email: str) -> None:
    password_hash = hash_password(_prompt_password())
    async with async_session_maker() as session:
        user = await _get_user(session, email)
        if not user:
            raise SystemExit(f"No user found for {email}.")
        user.password_hash = password_hash
        await session.commit()
    print(f"Password updated for {email}.")


async def invite(email: str, days: int) -> None:
    async with async_session_maker() as session:
        if await _get_user(session, email):
            raise SystemExit(f"A user already exists for {email}.")
    token = create_invite_token(email, timedelta(days=days))
    print(f"Invite for {email}, valid {days} day(s). Send them this link:\n")
    print(f"  /register?token={token}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_create = sub.add_parser("create", help="create a local account")
    p_create.add_argument("email")
    p_create.add_argument("--display-name", required=True)

    p_set = sub.add_parser("set-password", help="change an existing password")
    p_set.add_argument("email")

    p_invite = sub.add_parser("invite", help="mint a signup invite token")
    p_invite.add_argument("email")
    p_invite.add_argument("--days", type=int, default=7)

    args = parser.parse_args()
    email = args.email.strip().lower()

    try:
        if args.command == "create":
            asyncio.run(create(email, args.display_name))
        elif args.command == "set-password":
            asyncio.run(set_password(email))
        else:
            asyncio.run(invite(email, args.days))
    except PasswordPolicyError as e:
        raise SystemExit(str(e)) from None


if __name__ == "__main__":
    main()
