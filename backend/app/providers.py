"""Model providers behind the AirDial gateway.

The extension speaks one wire format (Messages-API shaped: system, messages
with text / image / tool_use / tool_result blocks, tools with input_schema)
and asks for an AirDial *mode* ("best", "fast"), never a vendor model. Each
provider maps a mode to its own model and translates the request.

Add a provider by implementing `Provider` and listing it in AIRDIAL_PROVIDERS.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Protocol

import anthropic
import httpx

from .config import settings

log = logging.getLogger("airdial.providers")


class ProviderUnavailable(Exception):
    """Provider-side problem (billing, auth, rate limit, outage). Try the next provider."""


class RequestRejected(Exception):
    """The provider rejected the request itself (malformed / too long). Retrying elsewhere won't help."""


class Provider(Protocol):
    name: str

    def supports(self, mode: str) -> bool: ...

    async def create(self, mode: str, req: dict[str, Any]) -> dict[str, Any]:
        """Returns a Messages-API shaped message dict."""
        ...


# ---------------------------------------------------------------- Anthropic


class AnthropicProvider:
    name = "anthropic"
    BETAS = ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"]

    def __init__(self) -> None:
        self._client: anthropic.AsyncAnthropic | None = None

    @property
    def client(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None, max_retries=1)
        return self._client

    def supports(self, mode: str) -> bool:
        return bool(settings.anthropic_api_key) and bool(settings.mode_models.get(("anthropic", mode)))

    def build(self, mode: str, req: dict[str, Any]) -> dict[str, Any]:
        system = req.get("system")
        if isinstance(system, str):
            system = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        return {
            "model": settings.mode_models[("anthropic", mode)],
            "max_tokens": req["max_tokens"],
            "system": system,
            "messages": req["messages"],
            "tools": req.get("tools") or [],
            "thinking": {"type": "adaptive", "display": "updates"},
            "output_config": {"effort": settings.mode_effort.get(mode, "medium")},
            "fallbacks": "default",
            "cache_control": {"type": "ephemeral"},
        }

    async def create(self, mode: str, req: dict[str, Any]) -> dict[str, Any]:
        body = self.build(mode, req)
        try:
            message = await self.client.beta.messages.create(**body, betas=self.BETAS)
        except (anthropic.APIConnectionError, anthropic.InternalServerError, anthropic.RateLimitError,
                anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
            raise ProviderUnavailable(f"anthropic: {type(e).__name__}: {e}") from e
        except anthropic.APIStatusError as e:
            msg = str(e)
            # Billing and account problems come back as 400s; they're ours, not the request's.
            if e.status_code in (402, 529) or "credit balance" in msg or "billing" in msg.lower():
                raise ProviderUnavailable(f"anthropic: {msg}") from e
            raise RequestRejected(f"anthropic: {msg}") from e
        return message.to_dict()


# ---------------------------------------------------------------- OpenAI


def to_openai(req: dict[str, Any], model: str) -> dict[str, Any]:
    """Messages-API request -> OpenAI Chat Completions request."""
    out: list[dict[str, Any]] = []
    system = req.get("system")
    if isinstance(system, list):
        system = "\n\n".join(b.get("text", "") for b in system if b.get("type") == "text")
    if system:
        out.append({"role": "system", "content": system})

    for m in req["messages"]:
        content = m["content"]
        if isinstance(content, str):
            out.append({"role": m["role"], "content": content})
            continue
        if m["role"] == "assistant":
            text = "".join(b.get("text", "") for b in content if b.get("type") == "text")
            calls = [
                {"id": b["id"], "type": "function", "function": {"name": b["name"], "arguments": json.dumps(b.get("input") or {})}}
                for b in content
                if b.get("type") == "tool_use"
            ]
            msg: dict[str, Any] = {"role": "assistant", "content": text or None}
            if calls:
                msg["tool_calls"] = calls
            if text or calls:
                out.append(msg)
            continue
        # user turn: tool results become tool messages; images inside them follow as a user message
        parts: list[dict[str, Any]] = []
        pending_images: list[dict[str, Any]] = []
        for b in content:
            t = b.get("type")
            if t == "tool_result":
                c = b.get("content")
                if isinstance(c, list):
                    texts = [x.get("text", "") for x in c if x.get("type") == "text"]
                    pending_images += [_image_part(x) for x in c if x.get("type") == "image"]
                    c = "\n".join(texts) or ("(see image)" if pending_images else "")
                if b.get("is_error"):
                    c = f"ERROR: {c}"
                out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": c or ""})
            elif t == "text":
                parts.append({"type": "text", "text": b["text"]})
            elif t == "image":
                parts.append(_image_part(b))
        parts = pending_images + parts
        if parts:
            out.append({"role": "user", "content": parts})

    tools = [
        {"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": t["input_schema"]}}
        for t in req.get("tools") or []
        if "input_schema" in t  # vendor server tools (web search) have no portable equivalent here
    ]
    body: dict[str, Any] = {"model": model, "messages": out, "max_completion_tokens": req["max_tokens"]}
    if tools:
        body["tools"] = tools
    return body


def _image_part(b: dict[str, Any]) -> dict[str, Any]:
    src = b.get("source", {})
    url = src.get("url") or f"data:{src.get('media_type', 'image/jpeg')};base64,{src.get('data', '')}"
    return {"type": "image_url", "image_url": {"url": url}}


_FINISH = {"stop": "end_turn", "tool_calls": "tool_use", "length": "max_tokens", "content_filter": "refusal"}


def from_openai(data: dict[str, Any], mode: str) -> dict[str, Any]:
    """OpenAI Chat Completions response -> Messages-API message."""
    choice = data["choices"][0]
    msg = choice["message"]
    content: list[dict[str, Any]] = []
    if msg.get("content"):
        content.append({"type": "text", "text": msg["content"]})
    for call in msg.get("tool_calls") or []:
        try:
            args = json.loads(call["function"].get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        content.append({"type": "tool_use", "id": call["id"], "name": call["function"]["name"], "input": args})
    stop = _FINISH.get(choice.get("finish_reason"), "end_turn")
    if stop == "end_turn" and any(b["type"] == "tool_use" for b in content):
        stop = "tool_use"
    usage = data.get("usage") or {}
    return {
        "id": data.get("id", ""),
        "type": "message",
        "role": "assistant",
        "model": data.get("model", ""),
        "content": content,
        "stop_reason": stop,
        "stop_sequence": None,
        "usage": {"input_tokens": usage.get("prompt_tokens", 0), "output_tokens": usage.get("completion_tokens", 0)},
    }


class OpenAIProvider:
    name = "openai"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    def supports(self, mode: str) -> bool:
        return bool(settings.openai_api_key) and bool(settings.mode_models.get(("openai", mode)))

    async def create(self, mode: str, req: dict[str, Any]) -> dict[str, Any]:
        body = to_openai(req, settings.mode_models[("openai", mode)])
        try:
            async with httpx.AsyncClient(base_url=settings.openai_base_url, timeout=120, transport=self._transport) as client:
                res = await client.post("/chat/completions", json=body, headers={"Authorization": f"Bearer {settings.openai_api_key}"})
        except httpx.HTTPError as e:
            raise ProviderUnavailable(f"openai: {e}") from e
        if res.status_code in (401, 402, 403, 429) or res.status_code >= 500:
            raise ProviderUnavailable(f"openai: {res.status_code} {res.text[:300]}")
        if res.status_code >= 400:
            raise RequestRejected(f"openai: {res.status_code} {res.text[:300]}")
        return from_openai(res.json(), mode)


REGISTRY = {"anthropic": AnthropicProvider, "openai": OpenAIProvider}


def build_providers() -> list[Provider]:
    return [REGISTRY[name]() for name in settings.providers if name in REGISTRY]

