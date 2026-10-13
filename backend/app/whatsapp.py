"""AirDial WhatsApp Business API send path (Meta Cloud API).

Free-form text inside the 24-hour customer-service window; outside it, an
approved template is required. Inbound webhooks are stored so the agent can
see replies without reading WhatsApp Web.
"""

from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from . import db
from .auth import current_user
from .config import settings

router = APIRouter(prefix="/v1/whatsapp")


class SendIn(BaseModel):
    to: str
    text: str
    kind: str = "reply"
    # When the 24-hour window is closed, send the follow-up template instead.
    use_template: bool = False
    template_params: list[str] = []


def _payload(body: SendIn) -> dict:
    to = "".join(ch for ch in body.to if ch.isdigit())
    if body.use_template:
        if not settings.whatsapp_followup_template:
            raise HTTPException(400, "No follow-up template is configured for this number.")
        return {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": settings.whatsapp_followup_template,
                "language": {"code": settings.whatsapp_template_lang},
                "components": [{"type": "body", "parameters": [{"type": "text", "text": p} for p in body.template_params]}],
            },
        }
    return {"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"preview_url": False, "body": body.text}}


@router.post("/send")
async def send(body: SendIn, user: str = Depends(current_user)):
    if not settings.whatsapp_token or not settings.whatsapp_phone_number_id:
        raise HTTPException(503, "This account isn't connected to the AirDial WhatsApp API yet.")
    url = f"https://graph.facebook.com/{settings.whatsapp_graph_version}/{settings.whatsapp_phone_number_id}/messages"
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(url, json=_payload(body), headers={"Authorization": f"Bearer {settings.whatsapp_token}"})
    data = res.json() if res.headers.get("content-type", "").startswith("application/json") else {"raw": res.text}
    if res.status_code >= 400:
        err = data.get("error", {}) if isinstance(data, dict) else {}
        # 131047: re-engagement message, i.e. outside the 24-hour window.
        code: Literal["window_closed", "send_failed"] = "window_closed" if err.get("code") == 131047 else "send_failed"
        raise HTTPException(502, {"code": code, "message": err.get("message", "WhatsApp rejected the message.")})
    return {"ok": True, "id": (data.get("messages") or [{}])[0].get("id"), "user": user}


@router.get("/webhook")
def verify(mode: str = Query(alias="hub.mode"), token: str = Query(alias="hub.verify_token"), challenge: str = Query(alias="hub.challenge")):
    if mode == "subscribe" and settings.whatsapp_verify_token and token == settings.whatsapp_verify_token:
        return PlainTextResponse(challenge)
    raise HTTPException(403, "Verification failed")


@router.post("/webhook")
async def inbound(request: Request):
    # TODO before production: verify X-Hub-Signature-256 with the app secret.
    payload = await request.json()
    with db.engine().begin() as conn:
        conn.execute(db.whatsapp_events.insert().values(at=db.now(), payload=payload))
    return {"ok": True}
