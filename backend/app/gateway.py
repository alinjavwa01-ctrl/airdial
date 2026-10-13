"""AirDial model gateway: POST /v1/messages.

The extension asks for a mode ("airdial-best" / "airdial-fast"). The gateway
checks the AirDial token and allowance, then tries each configured provider
in order (Claude first today; OpenAI or others as backups) and returns a
Messages-API shaped reply. Provider problems (billing, keys, rate limits,
outages) move on to the next provider and are logged for the AirDial team;
customers only ever see AirDial wording, never a vendor error.
"""

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from . import db
from .auth import current_user
from .config import MODES, settings
from .providers import Provider, ProviderUnavailable, RequestRejected, build_providers

log = logging.getLogger("airdial.gateway")
router = APIRouter()

# $ per million tokens: input, output, cache read, cache write. Extend via AIRDIAL_PRICES="model:in:out,..."
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-opus-5-5": (4.0, 20.0, 0.20, 5.0),
    "claude-sonnet-5-5": (2.0, 10.0, 0.20, 2.5),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
}
for _item in filter(None, os.getenv("AIRDIAL_PRICES", "").split(",")):
    _m, _in, _out = _item.split(":")
    PRICES[_m] = (float(_in), float(_out), float(_in) / 10, float(_in))

# Customer-facing wording. Never include provider names or raw errors.
MSG_BUSY = "AirDial Agent is busy right now. Please try again in a minute."
MSG_STEP = "AirDial Agent couldn't complete this step. Try again, or say it a different way."
MSG_ALLOWANCE = "You've used this month's AirDial Agent allowance. Upgrade your plan to keep going."
MSG_MODE = "This AirDial Agent mode isn't available on your plan."


def cost_usd(model: str, u: dict[str, Any]) -> float:
    p_in, p_out, p_cr, p_cw = PRICES.get(model, (0.0, 0.0, 0.0, 0.0))
    return (
        u.get("input_tokens", 0) * p_in
        + u.get("output_tokens", 0) * p_out
        + (u.get("cache_read_input_tokens") or 0) * p_cr
        + (u.get("cache_creation_input_tokens") or 0) * p_cw
    ) / 1_000_000


_providers: list[Provider] | None = None


def providers() -> list[Provider]:
    global _providers
    if _providers is None:
        _providers = build_providers()
    return _providers


def set_providers(p: list[Provider]) -> None:
    """Tests inject fake providers."""
    global _providers
    _providers = p


def _error(status: int, kind: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"type": "error", "error": {"type": kind, "message": message}})


@router.post("/v1/messages")
async def messages(request: Request, user: str = Depends(current_user)):
    body = await request.json()
    if body.get("stream"):
        return _error(400, "invalid_request_error", MSG_STEP)
    mode = str(body.get("model", "")).removeprefix("airdial-")
    if mode not in MODES:
        return _error(400, "invalid_request_error", MSG_MODE)
    if settings.monthly_cost_cap_usd and db.month_cost(user) >= settings.monthly_cost_cap_usd:
        return _error(429, "rate_limit_error", MSG_ALLOWANCE)

    req = {
        "system": body.get("system"),
        "messages": body.get("messages") or [],
        "tools": body.get("tools") or [],
        "max_tokens": min(int(body.get("max_tokens") or settings.max_tokens), settings.max_tokens),
    }

    candidates = [p for p in providers() if p.supports(mode)]
    if not candidates:
        log.error("no provider configured for mode %s", mode)
        return _error(503, "overloaded_error", MSG_BUSY)

    message: dict[str, Any] | None = None
    served_by = ""
    for provider in candidates:
        try:
            message = await provider.create(mode, req)
            served_by = provider.name
            break
        except ProviderUnavailable as e:
            log.warning("provider %s unavailable for user %s: %s", provider.name, user, e)
            continue
        except RequestRejected as e:
            log.error("provider %s rejected request for user %s: %s", provider.name, user, e)
            return _error(400, "invalid_request_error", MSG_STEP)
        except Exception:  # noqa: BLE001 - a broken adapter must not leak a 500 with internals
            log.exception("provider %s crashed", provider.name)
            continue
    if message is None:
        log.error("all providers failed for user %s mode %s", user, mode)
        return _error(503, "overloaded_error", MSG_BUSY)

    vendor_model = message.get("model", "")
    u = message.get("usage") or {}
    with db.engine().begin() as conn:
        conn.execute(
            db.usage.insert().values(
                user_id=user,
                at=db.now(),
                model=f"{served_by}:{vendor_model}",
                input_tokens=int(u.get("input_tokens", 0)) + int(u.get("cache_read_input_tokens") or 0) + int(u.get("cache_creation_input_tokens") or 0),
                output_tokens=int(u.get("output_tokens", 0)),
                cost_usd=cost_usd(vendor_model, u),
            )
        )
    # The client sees the AirDial mode, not the vendor model.
    message["model"] = f"airdial-{mode}"
    return JSONResponse(message)
