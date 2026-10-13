"""Storage for communication management.

SQLAlchemy Core so the same code runs on SQLite locally and Supabase Postgres
in production. Records are stored as JSON documents (the extension's shapes)
with the few columns we query on pulled out.
"""

import json
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    func,
    select,
)
from sqlalchemy.engine import Engine

from .config import settings

metadata = MetaData()

contacts = Table(
    "contacts",
    metadata,
    Column("user_id", String, primary_key=True),
    Column("id", String, primary_key=True),
    Column("name", String, nullable=False),
    Column("channel", String, nullable=False),
    Column("stage", String, nullable=False, default="new"),
    Column("next_date", String, nullable=True, index=True),
    Column("doc", JSON, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

approvals = Table(
    "approvals",
    metadata,
    Column("user_id", String, primary_key=True),
    Column("id", String, primary_key=True),
    Column("status", String, nullable=False, index=True),
    Column("kind", String, nullable=False),
    Column("contact_name", String, nullable=False),
    Column("sent_at", String, nullable=True),
    Column("doc", JSON, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

audit_log = Table(
    "audit_log",
    metadata,
    Column("user_id", String, primary_key=True),
    Column("id", String, primary_key=True),
    Column("at", String, nullable=False, index=True),
    Column("tier", String, nullable=False),
    Column("action", String, nullable=False),
    Column("outcome", String, nullable=False),
    Column("doc", JSON, nullable=False),
)

usage = Table(
    "model_usage",
    metadata,
    Column("pk", Integer, primary_key=True, autoincrement=True),
    Column("user_id", String, nullable=False, index=True),
    Column("at", DateTime(timezone=True), nullable=False),
    Column("model", String, nullable=False),
    Column("input_tokens", Integer, nullable=False),
    Column("output_tokens", Integer, nullable=False),
    Column("cost_usd", Float, nullable=False),
)

whatsapp_events = Table(
    "whatsapp_events",
    metadata,
    Column("pk", Integer, primary_key=True, autoincrement=True),
    Column("at", DateTime(timezone=True), nullable=False),
    Column("payload", JSON, nullable=False),
)

_engine: Engine | None = None


def engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(settings.database_url, future=True)
        metadata.create_all(_engine)
    return _engine


def reset_engine(url: str) -> Engine:
    """Tests point the app at a fresh database."""
    global _engine
    _engine = create_engine(url, future=True)
    metadata.create_all(_engine)
    return _engine


def now() -> datetime:
    return datetime.now(timezone.utc)


def upsert(table: Table, key: dict, values: dict) -> None:
    with engine().begin() as conn:
        cond = [table.c[k] == v for k, v in key.items()]
        exists = conn.execute(select(func.count()).select_from(table).where(*cond)).scalar()
        if exists:
            conn.execute(table.update().where(*cond).values(**values))
        else:
            conn.execute(table.insert().values(**key, **values))


def month_cost(user_id: str) -> float:
    start = now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    with engine().connect() as conn:
        total = conn.execute(
            select(func.coalesce(func.sum(usage.c.cost_usd), 0.0)).where(usage.c.user_id == user_id, usage.c.at >= start)
        ).scalar()
    return float(total or 0.0)


def dumps(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False)
