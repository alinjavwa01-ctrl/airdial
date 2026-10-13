import os

os.environ["AIRDIAL_TOKENS"] = "t1:alice,t2:bob"
os.environ["AIRDIAL_MONTHLY_COST_CAP_USD"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db, gateway  # noqa: E402
from app.providers import ProviderUnavailable, RequestRejected  # noqa: E402
from app.main import app  # noqa: E402

A = {"x-api-key": "t1"}
B = {"x-api-key": "t2"}


class FakeProvider:
    def __init__(self, name="fake", fail_with=None, modes=("best", "fast")):
        self.name = name
        self.calls = []
        self.fail_with = fail_with
        self.modes = modes

    def supports(self, mode):
        return mode in self.modes

    async def create(self, mode, req):
        self.calls.append((mode, req))
        if self.fail_with:
            raise self.fail_with
        return {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "claude-opus-5-5",
            "content": [{"type": "text", "text": "Drafted 2 replies."}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 1000, "output_tokens": 200},
        }


@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    db.reset_engine(f"sqlite:///{tmp_path}/t.db")
    yield


client = TestClient(app)
BODY = {"model": "airdial-best", "max_tokens": 999999, "system": "s", "messages": [{"role": "user", "content": "hi"}]}


def test_requires_token():
    assert client.post("/v1/messages", json=BODY).status_code == 401
    assert client.get("/v1/contacts", headers={"x-api-key": "nope"}).status_code == 401


def test_gateway_maps_mode_caps_tokens_and_meters():
    fake = FakeProvider()
    gateway.set_providers([fake])
    r = client.post("/v1/messages", json=BODY, headers=A)
    assert r.status_code == 200, r.text
    assert r.json()["content"][0]["text"] == "Drafted 2 replies."
    assert r.json()["model"] == "airdial-best"  # vendor model never reaches the client
    mode, req = fake.calls[0]
    assert mode == "best" and req["max_tokens"] == 16000
    assert db.month_cost("alice") == pytest.approx((1000 * 4 + 200 * 20) / 1e6)
    assert db.month_cost("bob") == 0


def test_gateway_rejects_unknown_mode_and_stream():
    gateway.set_providers([FakeProvider()])
    r = client.post("/v1/messages", json={**BODY, "model": "claude-opus-5-5"}, headers=A)
    assert r.status_code == 400 and "isn't available" in r.json()["error"]["message"]
    assert client.post("/v1/messages", json={**BODY, "stream": True}, headers=A).status_code == 400


def test_gateway_monthly_cap():
    gateway.set_providers([FakeProvider()])
    with db.engine().begin() as conn:
        conn.execute(db.usage.insert().values(user_id="alice", at=db.now(), model="x", input_tokens=1, output_tokens=1, cost_usd=5.0))
    r = client.post("/v1/messages", json=BODY, headers=A)
    assert r.status_code == 429 and "allowance" in r.json()["error"]["message"]
    assert client.post("/v1/messages", json=BODY, headers=B).status_code == 200


def test_billing_problem_fails_over_and_never_reaches_customer():
    down = FakeProvider("anthropic", fail_with=ProviderUnavailable("anthropic: Your credit balance is too low"))
    backup = FakeProvider("openai")
    gateway.set_providers([down, backup])
    r = client.post("/v1/messages", json=BODY, headers=A)
    assert r.status_code == 200 and len(backup.calls) == 1


def test_all_providers_down_gives_airdial_message():
    gateway.set_providers([FakeProvider("anthropic", fail_with=ProviderUnavailable("anthropic: credit balance is too low")),
                           FakeProvider("openai", fail_with=RuntimeError("boom"))])
    r = client.post("/v1/messages", json=BODY, headers=A)
    assert r.status_code == 503
    msg = r.json()["error"]["message"]
    assert msg.startswith("AirDial Agent is busy")
    assert "credit" not in msg and "anthropic" not in msg.lower() and "openai" not in msg.lower()


def test_request_rejected_is_generic():
    gateway.set_providers([FakeProvider(fail_with=RequestRejected("anthropic: messages.0: bad"))])
    r = client.post("/v1/messages", json=BODY, headers=A)
    assert r.status_code == 400 and "messages.0" not in r.text


def test_mode_without_provider():
    gateway.set_providers([FakeProvider(modes=("best",))])
    assert client.post("/v1/messages", json={**BODY, "model": "airdial-fast"}, headers=A).status_code == 503


CONTACT = {
    "id": "c1", "name": "Kouvas", "channel": "whatsapp", "handle": "+260971234567", "stage": "quoted",
    "language": "Nyanja", "lastTheySaid": "Can you send photos?", "nextStep": "Send photos of T-bone",
    "nextDate": "2026-10-13", "cashExpected": {"amount": 6000, "currency": "ZMW"},
    "history": [{"at": "2026-10-13T09:12:00Z", "summary": "Asked for 50 kg T-bone"}],
}


def test_sync_followups_summary_and_isolation():
    r = client.put("/v1/sync", headers=A, json={
        "contacts": [CONTACT, {**CONTACT, "id": "c2", "name": "Banda", "nextDate": "2026-10-20", "cashExpected": None, "history": []}],
        "approvals": [
            {"id": "m1", "createdAt": "2026-10-13T09:00:00Z", "contactName": "Kouvas", "channel": "whatsapp", "kind": "follow_up",
             "draft": "Muli bwanji, photos coming", "status": "sent", "sentAt": "2026-10-13T09:30:00Z", "edited": True},
            {"id": "m2", "createdAt": "2026-10-13T09:00:00Z", "contactName": "Banda", "channel": "whatsapp", "kind": "reply",
             "draft": "Yes we deliver", "status": "pending"},
        ],
        "audit": [{"id": "a1", "at": "2026-10-13T09:30:00Z", "tier": "approve", "action": "send", "label": "Sent follow up to Kouvas", "outcome": "ok"}],
    })
    assert r.status_code == 200, r.text
    due = client.get("/v1/followups/due?day=2026-10-13", headers=A).json()
    assert [c["name"] for c in due] == ["Kouvas"]
    s = client.get("/v1/summary/daily?day=2026-10-13", headers=A).json()
    assert (s["sent"], s["sentEdited"], s["replies"], s["needsYou"]) == (1, 1, 1, 1)
    assert s["cashExpected"] == {"ZMW": 6000.0}
    assert client.get("/v1/approvals?status=pending", headers=A).json()[0]["id"] == "m2"
    assert len(client.get("/v1/audit", headers=A).json()) == 1
    # Another user sees none of it.
    assert client.get("/v1/contacts", headers=B).json() == []
    # Re-sync updates in place; deletion on request.
    client.put("/v1/sync", headers=A, json={"contacts": [{**CONTACT, "stage": "won"}], "deletedContactIds": ["c2"]})
    contacts = client.get("/v1/contacts", headers=A).json()
    assert [(c["name"], c["stage"]) for c in contacts] == [("Kouvas", "won")]


def test_whatsapp_send_requires_connected_number():
    r = client.post("/v1/whatsapp/send", headers=A, json={"to": "+260 97 123 4567", "text": "hi"})
    assert r.status_code == 503


def test_whatsapp_payloads():
    from app.whatsapp import SendIn, _payload

    p = _payload(SendIn(to="+260 97 123 4567", text="Muli bwanji"))
    assert p == {"messaging_product": "whatsapp", "to": "260971234567", "type": "text", "text": {"preview_url": False, "body": "Muli bwanji"}}
