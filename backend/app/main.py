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
def health():
    return {"ok": True}
