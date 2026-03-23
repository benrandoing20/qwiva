import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.config import get_settings
from backend.models import UserProfile

_bearer = HTTPBearer()


def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> UserProfile:
    """
    FastAPI dependency that validates a Supabase-issued JWT (HS256).
    Returns the authenticated user's profile on success.
    Raises 401 on any verification failure.
    """
    token = credentials.credentials
    settings = get_settings()

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            options={"require": ["sub", "exp"], "verify_aud": False},
        )
    except (jwt.ExpiredSignatureError, jwt.PyJWTError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )

    return UserProfile(
        user_id=payload["sub"],
        email=payload.get("email"),
    )
