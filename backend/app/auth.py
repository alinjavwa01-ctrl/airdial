"""Who is calling.

Customers sign in with Supabase Auth in the extension and send their access
token (a JWT) in x-api-key. We verify it against the project's signing keys
(JWKS) or, for projects on the legacy shared secret, SUPABASE_JWT_SECRET.
Static AIRDIAL_TOKENS remain for internal testing and the e2e suite.
"""

import logging
import time

import jwt
from fastapi import Header, HTTPException

from .config import settings

log = logging.getLogger("airdial.auth")
_jwks: jwt.PyJWKClient | None = None


def _jwks_client() -> jwt.PyJWKClient | None:
    global _jwks
    if _jwks is None and settings.supabase_url:
        _jwks = jwt.PyJWKClient(f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)
    return _jwks


def verify_supabase_jwt(token: str) -> str | None:
    """Returns the Supabase user id, or None if the token is not a valid session."""
    if not settings.supabase_url:
        return None
    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") == "HS256":
            if not settings.supabase_jwt_secret:
                return None
            key: object = settings.supabase_jwt_secret
        else:
            client = _jwks_client()
            assert client is not None
            key = client.get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256", "ES256", "HS256"], audience="authenticated", issuer=issuer, leeway=30)
    except Exception as e:  # noqa: BLE001 - any failure means "not signed in"
        log.info("rejected session token: %s", type(e).__name__)
        return None
    if claims.get("exp", 0) < time.time() - 30:
        return None
    return str(claims["sub"])


def current_user(
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> str:
    token = x_api_key or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None)
    if token:
        user = settings.tokens.get(token)
        if user:
            return user
        if token.count(".") == 2:
            uid = verify_supabase_jwt(token)
            if uid:
                return uid
    raise HTTPException(status_code=401, detail={"type": "authentication_error", "message": "Please sign in to AirDial again."})
