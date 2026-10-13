"""Communication management: contacts, approval queue, follow-ups, audit log,
daily summary. This is the system of record; the extension syncs to it and
keeps a local cache so it works offline.
"""

from datetime import date, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from . import db
from .auth import current_user

router = APIRouter(prefix="/v1")

Channel = Literal["whatsapp", "linkedin", "email", "other"]


class ContactIn(BaseModel):
    id: str
    name: str
    channel: Channel
    handle: str = ""
    stage: str = "new"
    language: str | None = None
    notes: str = ""
    lastTheySaid: str = ""
    lastWeAsked: str = ""
    nextStep: str = ""
    nextDate: str = ""
    cashExpected: dict[str, Any] | None = None
    history: list[dict[str, Any]] = Field(default_factory=list)
    updatedAt: str | None = None


class ApprovalIn(BaseModel):
    id: str
    createdAt: str
    contactName: str
    channel: Channel
    kind: str
    draft: str
    status: Literal["pending", "sending", "sent", "skipped", "failed"]
    theirLastMessage: str = ""
    taskId: str | None = None
    contactId: str | None = None
    language: str | None = None
    reason: str | None = None
    sourceUrl: str | None = None
    edited: bool | None = None
    error: str | None = None
    sentAt: str | None = None


class AuditIn(BaseModel):
    id: str
    at: str
    tier: Literal["free", "approve", "never"]
    action: str
    label: str
    outcome: str
    taskId: str | None = None
    url: str | None = None
    before: str | None = None
    after: str | None = None


class SyncIn(BaseModel):
    contacts: list[ContactIn] = Field(default_factory=list)
    approvals: list[ApprovalIn] = Field(default_factory=list)
    audit: list[AuditIn] = Field(default_factory=list)
    deletedContactIds: list[str] = Field(default_factory=list)


def _put_contact(user: str, c: ContactIn) -> None:
    db.upsert(
        db.contacts,
        {"user_id": user, "id": c.id},
        {"name": c.name, "channel": c.channel, "stage": c.stage, "next_date": c.nextDate or None, "doc": c.model_dump(), "updated_at": db.now()},
    )


def _put_approval(user: str, a: ApprovalIn) -> None:
    db.upsert(
        db.approvals,
        {"user_id": user, "id": a.id},
        {"status": a.status, "kind": a.kind, "contact_name": a.contactName, "sent_at": a.sentAt, "doc": a.model_dump(), "updated_at": db.now()},
    )


@router.put("/sync")
def sync(body: SyncIn, user: str = Depends(current_user)):
    """Upserts everything the extension changed since its last sync."""
    for c in body.contacts:
        _put_contact(user, c)
    for a in body.approvals:
        _put_approval(user, a)
    for e in body.audit:
        db.upsert(db.audit_log, {"user_id": user, "id": e.id}, {"at": e.at, "tier": e.tier, "action": e.action, "outcome": e.outcome, "doc": e.model_dump()})
    if body.deletedContactIds:
        with db.engine().begin() as conn:
            conn.execute(db.contacts.delete().where(db.contacts.c.user_id == user, db.contacts.c.id.in_(body.deletedContactIds)))
    return {"contacts": len(body.contacts), "approvals": len(body.approvals), "audit": len(body.audit)}


@router.get("/contacts")
def list_contacts(user: str = Depends(current_user)):
    with db.engine().connect() as conn:
        rows = conn.execute(select(db.contacts.c.doc).where(db.contacts.c.user_id == user).order_by(db.contacts.c.name)).all()
    return [r.doc for r in rows]


@router.put("/contacts/{contact_id}")
def put_contact(contact_id: str, c: ContactIn, user: str = Depends(current_user)):
    if c.id != contact_id:
        raise HTTPException(400, "id mismatch")
    _put_contact(user, c)
    return c


@router.delete("/contacts/{contact_id}")
def delete_contact(contact_id: str, user: str = Depends(current_user)):
    """PRD: contact memory is deletable on request."""
    with db.engine().begin() as conn:
        conn.execute(db.contacts.delete().where(db.contacts.c.user_id == user, db.contacts.c.id == contact_id))
    return {"deleted": contact_id}


@router.get("/followups/due")
def followups_due(day: date | None = None, user: str = Depends(current_user)):
    """The morning "what's due" list. A scheduler (Inngest/Temporal) calls this
    per user and pushes a notification or drafts nudges."""
    d = (day or date.today()).isoformat()
    with db.engine().connect() as conn:
        rows = conn.execute(
            select(db.contacts.c.doc)
            .where(
                db.contacts.c.user_id == user,
                db.contacts.c.next_date.is_not(None),
                db.contacts.c.next_date <= d,
                db.contacts.c.stage.not_in(["lost", "won"]),
            )
            .order_by(db.contacts.c.next_date)
        ).all()
    return [r.doc for r in rows]


@router.get("/approvals")
def list_approvals(status: str | None = None, user: str = Depends(current_user)):
    q = select(db.approvals.c.doc).where(db.approvals.c.user_id == user)
    if status:
        q = q.where(db.approvals.c.status == status)
    with db.engine().connect() as conn:
        return [r.doc for r in conn.execute(q).all()]


@router.get("/audit")
def list_audit(limit: int = 500, user: str = Depends(current_user)):
    with db.engine().connect() as conn:
        rows = conn.execute(
            select(db.audit_log.c.doc).where(db.audit_log.c.user_id == user).order_by(db.audit_log.c.at.desc()).limit(min(limit, 5000))
        ).all()
    return [r.doc for r in rows]


@router.get("/summary/daily")
def daily_summary(day: date | None = None, user: str = Depends(current_user)):
    """End-of-day report: sent, replies, needs you, cash expected."""
    d = (day or date.today()).isoformat()
    with db.engine().connect() as conn:
        appr = [r.doc for r in conn.execute(select(db.approvals.c.doc).where(db.approvals.c.user_id == user)).all()]
        cons = [r.doc for r in conn.execute(select(db.contacts.c.doc).where(db.contacts.c.user_id == user)).all()]

    def on_day(iso: str | None) -> bool:
        return bool(iso) and iso[:10] == d

    sent = [a for a in appr if a["status"] == "sent" and on_day(a.get("sentAt"))]
    repliers = [c["name"] for c in cons if any(on_day(h.get("at")) and not h.get("summary", "").startswith("We sent") for h in c.get("history", []))]
    cash: dict[str, float] = {}
    for c in cons:
        ce = c.get("cashExpected")
        if ce and c.get("stage") != "lost":
            cash[ce.get("currency", "ZMW")] = cash.get(ce.get("currency", "ZMW"), 0) + float(ce.get("amount", 0))
    return {
        "day": d,
        "sent": len(sent),
        "sentEdited": sum(1 for a in sent if a.get("edited")),
        "replies": len(repliers),
        "replyNames": repliers,
        "needsYou": sum(1 for a in appr if a["status"] in ("pending", "failed")),
        "cashExpected": cash,
        "modelCostUsdThisMonth": round(db.month_cost(user), 4),
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
    }
