import json
import os

os.environ.setdefault("AIRDIAL_TOKENS", "t1:alice")

import asyncio  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from app import providers  # noqa: E402
from app.config import Settings  # noqa: E402
from app.providers import AnthropicProvider, OpenAIProvider, ProviderUnavailable, from_openai, to_openai  # noqa: E402

REQ = {
    "system": [{"type": "text", "text": "You are AirDial Agent."}],
    "max_tokens": 1000,
    "tools": [
        {"name": "click", "description": "Click", "input_schema": {"type": "object", "properties": {"ref": {"type": "string"}}}},
        {"type": "web_search_20260209", "name": "web_search"},
    ],
    "messages": [
        {"role": "user", "content": "Fill the form"},
        {"role": "assistant", "content": [
            {"type": "thinking", "thinking": "", "signature": "x"},
            {"type": "text", "text": "Reading."},
            {"type": "tool_use", "id": "tu_1", "name": "screenshot", "input": {}},
        ]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "tu_1", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "AAA"}},
                {"type": "text", "text": "Viewport 1100x760"},
            ]},
        ]},
    ],
}


def test_to_openai_translates_blocks_and_drops_vendor_only_parts():
    b = to_openai(REQ, "gpt-x")
    assert b["model"] == "gpt-x" and b["max_completion_tokens"] == 1000
    roles = [m["role"] for m in b["messages"]]
    assert roles == ["system", "user", "assistant", "tool", "user"]
    assert b["messages"][2]["tool_calls"][0]["function"] == {"name": "screenshot", "arguments": "{}"}
    assert b["messages"][3] == {"role": "tool", "tool_call_id": "tu_1", "content": "Viewport 1100x760"}
    assert b["messages"][4]["content"][0]["image_url"]["url"] == "data:image/jpeg;base64,AAA"
    assert [t["function"]["name"] for t in b["tools"]] == ["click"]  # web search has no portable equivalent


def test_from_openai_tool_calls():
    m = from_openai({"id": "c1", "model": "gpt-x", "choices": [{"finish_reason": "tool_calls", "message": {
        "content": None, "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "click", "arguments": "{\"ref\": \"e3\"}"}}]}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5}}, "best")
    assert m["stop_reason"] == "tool_use"
    assert m["content"] == [{"type": "tool_use", "id": "call_1", "name": "click", "input": {"ref": "e3"}}]
    assert m["usage"] == {"input_tokens": 10, "output_tokens": 5}


def test_openai_provider_billing_error_is_unavailable(monkeypatch):
    monkeypatch.setattr(providers, "settings", Settings(openai_api_key="k", mode_models={("openai", "best"): "gpt-x"}))
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["model"] == "gpt-x"
        return httpx.Response(429, json={"error": {"message": "You exceeded your current quota"}})
    p = OpenAIProvider(transport=httpx.MockTransport(handler))
    assert p.supports("best") and not p.supports("fast")
    with pytest.raises(ProviderUnavailable):
        asyncio.run(p.create("best", REQ))


def test_anthropic_request_is_built_server_side(monkeypatch):
    monkeypatch.setattr(providers, "settings", Settings(anthropic_api_key="k"))
    b = AnthropicProvider().build("fast", {**REQ, "system": "Hi"})
    assert b["model"] == "claude-sonnet-5-5"
    assert b["output_config"] == {"effort": "low"} and b["fallbacks"] == "default"
    assert b["system"][0]["cache_control"] == {"type": "ephemeral"}
