from fastapi import Header, HTTPException

from .config import settings


def current_user(
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> str:
    """Resolves the caller to a user id.

    The extension sends its AirDial token in x-api-key (the Anthropic SDK's
    header, since it talks to /v1/messages directly). Bearer is accepted for
    other clients. Beta auth is a static token map; production should verify
    Supabase Auth JWTs here instead.
    """
    token = x_api_key or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None)
    user = settings.tokens.get(token or "")
    if not user:
        raise HTTPException(status_code=401, detail={"type": "authentication_error", "message": "Invalid AirDial token."})
    return user
