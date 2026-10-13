import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import comms, gateway, whatsapp

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="AirDial Agent backend", version="0.1.0")

# The side panel runs on a chrome-extension:// origin.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$|^http://localhost(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(gateway.router)
app.include_router(comms.router)
app.include_router(whatsapp.router)


@app.get("/health")
def health(deep: bool = False):
    if not deep:
        return {"ok": True}
    from sqlalchemy import text

    from . import db
    from .gateway import providers

    try:
        with db.engine().connect() as conn:
            conn.execute(text("select 1"))
        database = "ok"
    except Exception as e:  # noqa: BLE001
        database = f"error: {type(e).__name__}"
    modes = {m: [p.name for p in providers() if p.supports(m)] for m in ("best", "fast")}
    return {"ok": database == "ok", "database": database, "providers_ready": {m: bool(v) for m, v in modes.items()}}
