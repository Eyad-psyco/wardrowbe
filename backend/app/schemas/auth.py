from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class TokenPayload(BaseModel):
    sub: str  # Subject (external_id from OIDC)
    exp: int  # Expiration timestamp
    iat: int | None = None  # Issued at timestamp (optional for forward auth tokens)
    email: str | None = None
    name: str | None = None


class AuthSession(BaseModel):
    user_id: UUID
    external_id: str
    email: str
    display_name: str
    family_id: UUID | None = None
    role: str
    is_authenticated: bool = True


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=1024)


class RegisterRequest(BaseModel):
    invite_token: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1, max_length=1024)
    display_name: str = Field(..., min_length=1, max_length=100)


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=1024)
    display_name: str = Field(..., min_length=1, max_length=100)


class InviteCreateRequest(BaseModel):
    email: EmailStr
    expires_in_days: int = Field(default=7, ge=1, le=90)


class InviteCreateResponse(BaseModel):
    email: EmailStr
    token: str
    expires_in_days: int
