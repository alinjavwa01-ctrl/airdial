"""Model gateway: one /v1/messages endpoint in front of the model providers.

The extension's Anthropic SDK points its base URL here. The gateway checks
the AirDial token, enforces the model allowlist, token ceiling and monthly
spend cap, forwards to the provider holding the real key, and meters cost
per user (PRD: model cost under 30% of plan price per active user).

Providers sit behind `Provider`, so a backup can be added without touching
the extension. Only Anthropic is wired today.
"""

import inspect
from typing import Any, Protocol

import anthropic
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from . import db
from .auth import current_user
from .config import settings

router = APIRouter()

# $ per million tokens: input, output, cache read, cache write (5 min).
PRICES = {
    "claude-opus-5-5": (4.0, 20.0, 0.20, 5.0),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20, 2.5),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
}


def cost_usd(model: str, u: dict[str, Any]) -> float:
    p_in, p_out, p_cr, p_cw = PRICES.get(model, PRICES["claude-opus-5-5"])
    return (
        u.get("input_tokens", 0) * p_in
        + u.get("output_tokens", 0) * p_out
        + (u.get("cache_read_input_tokens") or 0) * p_cr
        + (u.get("cache_creation_input_tokens") or 0) * p_cw
    ) / 1_000_000


class Provider(Protocol):
    name: str

    async def create(self, body: dict[str, Any], betas: list[str]) -> dict[str, Any]: ...


class AnthropicProvider:
    name = "anthropic"

    def __init__(self) -> None:
        self.client = anthropic.AsyncAnthropic(max_retries=2)
        params = inspect.signature(self.client.beta.messages.create).parameters
        self._known = {k for k in params if k not in ("self", "betas", "extra_body", "extra_headers", "extra_query", "timeout")}

    async def create(self, body: dict[str, Any], betas: list[str]) -> dict[str, Any]:
        known = {k: v for k, v in body.items() if k in self._known and k != "stream"}
        extra = {k: v for k, v in body.items() if k not in self._known and k != "stream"}
        message = await self.client.beta.messages.create(**known, betas=betas, extra_body=extra or None)
        return message.to_dict()


_providers: list[Provider] | None = None


def providers() -> list[Provider]:
    global _providers
    if _providers is None:
        _providers = [AnthropicProvider()]
    return _providers


def set_providers(p: list[Provider]) -> None:
    """Tests inject a fake provider."""
    global _providers
    _providers = p


def _error(status: int, kind: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"type": "error", "error": {"type": kind, "message": message}})


@router.post("/v1/messages")
async def messages(request: Request, user: str = Depends(current_user)):
    body = await request.json()
    if body.get("stream"):
        return _error(400, "invalid_request_error", "Streaming is not supported through the AirDial gateway yet.")
    model = body.get("model")
    if model not in settings.allowed_models:
        return _error(400, "invalid_request_error", f"Model {model!r} is not enabled for AirDial Agent.")
    body["max_tokens"] = min(int(body.get("max_tokens") or settings.max_tokens), settings.max_tokens)
    if settings.monthly_cost_cap_usd and db.month_cost(user) >= settings.monthly_cost_cap_usd:
        return _error(429, "rate_limit_error", "You've used this month's agent allowance. Upgrade your plan to keep going.")

    betas = [b.strip() for b in request.headers.get("anthropic-beta", "").split(",") if b.strip()]

    last_exc: Exception | None = None
    for provider in providers():
        try:
            message = await provider.create(body, betas)
            break
        except (anthropic.APIConnectionError, anthropic.InternalServerError) as e:
            last_exc = e  # provider down: try the next one
            continue
        except anthropic.APIStatusError as e:
            # Client errors (400/401/404/429) pass straight back in the API's shape.
            err = e.body.get("error", {}) if isinstance(e.body, dict) else {}
            return _error(e.status_code, err.get("type", "api_error"), err.get("message", str(e)))
    else:
        return _error(529, "overloaded_error", f"No model provider available: {last_exc}")

    u = message.get("usage") or {}
    with db.engine().begin() as conn:
        conn.execute(
            db.usage.insert().values(
                user_id=user,
                at=db.now(),
                model=message.get("model", model),
                input_tokens=int(u.get("input_tokens", 0)) + int(u.get("cache_read_input_tokens") or 0) + int(u.get("cache_creation_input_tokens") or 0),
                output_tokens=int(u.get("output_tokens", 0)),
                cost_usd=cost_usd(message.get("model", model), u),
            )
        )
    return JSONResponse(message)
