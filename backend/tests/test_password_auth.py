"""Tests for local email+password accounts and invite-only signup."""

from datetime import timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.utils.invite import InviteError, create_invite_token, read_invite_token
from app.utils.password import (
    MAX_PASSWORD_BYTES,
    PasswordPolicyError,
    hash_password,
    verify_password,
)

PASSWORD = "correcthorsebattery"


@pytest.fixture
def local_email() -> str:
    return f"local-{uuid4()}@example.com"


async def _make_local_user(db_session: AsyncSession, email: str, password: str) -> User:
    user = User(
        external_id=f"local:{uuid4()}",
        email=email,
        display_name="Local User",
        password_hash=hash_password(password),
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


class TestPasswordHashing:
    def test_hash_and_verify_roundtrip(self):
        hashed = hash_password(PASSWORD)
        assert hashed != PASSWORD
        assert verify_password(PASSWORD, hashed)

    def test_wrong_password_rejected(self):
        assert not verify_password("not-the-password", hash_password(PASSWORD))

    def test_salted_so_hashes_differ(self):
        assert hash_password(PASSWORD) != hash_password(PASSWORD)

    def test_no_hash_never_verifies(self):
        """OIDC-only users have no password and must not be signed in as."""
        assert not verify_password(PASSWORD, None)
        assert not verify_password(PASSWORD, "")

    def test_malformed_hash_returns_false(self):
        assert not verify_password(PASSWORD, "not-a-bcrypt-hash")

    def test_short_password_rejected(self):
        with pytest.raises(PasswordPolicyError):
            hash_password("abcd")

    def test_overlong_password_rejected(self):
        """bcrypt ignores bytes past 72; refuse rather than silently truncate."""
        with pytest.raises(PasswordPolicyError):
            hash_password("a" * (MAX_PASSWORD_BYTES + 1))


class TestInviteTokens:
    def test_roundtrip_normalizes_email(self):
        assert read_invite_token(create_invite_token("  Me@Example.COM ")) == "me@example.com"

    def test_expired_invite_rejected(self):
        token = create_invite_token("a@example.com", timedelta(seconds=-1))
        with pytest.raises(InviteError):
            read_invite_token(token)

    def test_tampered_invite_rejected(self):
        with pytest.raises(InviteError):
            read_invite_token(create_invite_token("a@example.com") + "x")

    def test_garbage_invite_rejected(self):
        with pytest.raises(InviteError):
            read_invite_token("not-a-token")


class TestLogin:
    @pytest.mark.asyncio
    async def test_login_returns_usable_token(
        self, client: AsyncClient, db_session: AsyncSession, local_email: str
    ):
        await _make_local_user(db_session, local_email, PASSWORD)

        response = await client.post(
            "/api/v1/auth/login", json={"email": local_email, "password": PASSWORD}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["email"] == local_email
        assert body["is_new_user"] is False

        session = await client.get(
            "/api/v1/auth/session",
            headers={"Authorization": f"Bearer {body['access_token']}"},
        )
        assert session.status_code == 200
        assert session.json()["email"] == local_email

    @pytest.mark.asyncio
    async def test_wrong_password_rejected(
        self, client: AsyncClient, db_session: AsyncSession, local_email: str
    ):
        await _make_local_user(db_session, local_email, PASSWORD)
        response = await client.post(
            "/api/v1/auth/login", json={"email": local_email, "password": "wrong-password"}
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_unknown_email_matches_wrong_password_response(
        self, client: AsyncClient, db_session: AsyncSession, local_email: str
    ):
        """Neither response may reveal whether the account exists."""
        await _make_local_user(db_session, local_email, PASSWORD)

        unknown = await client.post(
            "/api/v1/auth/login",
            json={"email": f"missing-{uuid4()}@example.com", "password": PASSWORD},
        )
        wrong = await client.post(
            "/api/v1/auth/login", json={"email": local_email, "password": "wrong-password"}
        )
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json()["detail"] == wrong.json()["detail"]

    @pytest.mark.asyncio
    async def test_oidc_user_cannot_password_login(self, client: AsyncClient, test_user: User):
        """test_user has no password_hash, so no password may sign in as them."""
        response = await client.post(
            "/api/v1/auth/login", json={"email": test_user.email, "password": PASSWORD}
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_inactive_user_rejected(
        self, client: AsyncClient, db_session: AsyncSession, local_email: str
    ):
        user = await _make_local_user(db_session, local_email, PASSWORD)
        user.is_active = False
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login", json={"email": local_email, "password": PASSWORD}
        )
        assert response.status_code == 403


class TestRegister:
    @pytest.mark.asyncio
    async def test_register_with_invite(self, client: AsyncClient, local_email: str):
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "invite_token": create_invite_token(local_email),
                "password": PASSWORD,
                "display_name": "Invited User",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["email"] == local_email
        assert body["is_new_user"] is True
        assert body["external_id"].startswith("local:")

        login = await client.post(
            "/api/v1/auth/login", json={"email": local_email, "password": PASSWORD}
        )
        assert login.status_code == 200

    @pytest.mark.asyncio
    async def test_invite_cannot_be_replayed(self, client: AsyncClient, local_email: str):
        """Single use falls out of the unique email constraint, not a used flag."""
        token = create_invite_token(local_email)
        first = await client.post(
            "/api/v1/auth/register",
            json={"invite_token": token, "password": PASSWORD, "display_name": "First"},
        )
        assert first.status_code == 200

        second = await client.post(
            "/api/v1/auth/register",
            json={"invite_token": token, "password": PASSWORD, "display_name": "Second"},
        )
        assert second.status_code == 409

    @pytest.mark.asyncio
    async def test_register_without_valid_invite_rejected(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "invite_token": "forged.token.here",
                "password": PASSWORD,
                "display_name": "Nobody",
            },
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_expired_invite_rejected(self, client: AsyncClient, local_email: str):
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "invite_token": create_invite_token(local_email, timedelta(seconds=-1)),
                "password": PASSWORD,
                "display_name": "Late",
            },
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_weak_password_rejected(self, client: AsyncClient, local_email: str):
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "invite_token": create_invite_token(local_email),
                "password": "abcd",
                "display_name": "Weak",
            },
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_email_comes_from_invite_not_body(self, client: AsyncClient, local_email: str):
        """An extra email in the body must not override the signed one."""
        attacker_email = f"attacker-{uuid4()}@example.com"
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "invite_token": create_invite_token(local_email),
                "password": PASSWORD,
                "display_name": "Sneaky",
                "email": attacker_email,
            },
        )
        assert response.status_code == 200
        assert response.json()["email"] == local_email


class TestInviteEndpoint:
    @pytest.mark.asyncio
    async def test_requires_authentication(self, client: AsyncClient):
        response = await client.post("/api/v1/auth/invites", json={"email": "someone@example.com"})
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_signed_in_user_can_invite(
        self, client: AsyncClient, auth_headers: dict[str, str], local_email: str
    ):
        response = await client.post(
            "/api/v1/auth/invites", json={"email": local_email}, headers=auth_headers
        )
        assert response.status_code == 200
        body = response.json()
        assert body["email"] == local_email
        assert read_invite_token(body["token"]) == local_email

    @pytest.mark.asyncio
    async def test_cannot_invite_existing_user(
        self, client: AsyncClient, auth_headers: dict[str, str], test_user: User
    ):
        response = await client.post(
            "/api/v1/auth/invites", json={"email": test_user.email}, headers=auth_headers
        )
        assert response.status_code == 409
