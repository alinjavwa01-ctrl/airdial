import os
import time

os.environ.setdefault("AIRDIAL_TOKENS", "t1:alice")

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

from app import auth  # noqa: E402
from app.config import Settings  # noqa: E402

URL = "https://proj.supabase.co"


class FakeJWKS:
    def __init__(self, key):
        self.key = key

    def get_signing_key_from_jwt(self, token):
        return self


def make(key, **over):
    claims = {"sub": "user-123", "aud": "authenticated", "iss": f"{URL}/auth/v1", "exp": int(time.time()) + 600, **over}
    return jwt.encode(claims, key, algorithm="ES256", headers={"kid": "k1"})


def test_supabase_session_tokens(monkeypatch):
    priv = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(auth, "settings", Settings(supabase_url=URL))
    monkeypatch.setattr(auth, "_jwks", FakeJWKS(priv.public_key()))
    assert auth.verify_supabase_jwt(make(priv)) == "user-123"
    assert auth.verify_supabase_jwt(make(priv, exp=int(time.time()) - 3600)) is None
    assert auth.verify_supabase_jwt(make(priv, aud="anon")) is None
    other = ec.generate_private_key(ec.SECP256R1())
    assert auth.verify_supabase_jwt(make(other)) is None
