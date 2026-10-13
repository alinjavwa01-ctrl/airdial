"""Runs the real backend with a scripted model, for the browser end-to-end test.

The script plays the model's side of a task: plan, find the WhatsApp tab,
read the inbox, open Kouvas, try to press Send directly (the user denies it),
then queue a draft and save the contact.
"""

import json
import os
import re
import sys

os.environ.setdefault("AIRDIAL_TOKENS", "e2e-token:e2e")
os.environ.setdefault("DATABASE_URL", "sqlite:///./e2e.db")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

import uvicorn  # noqa: E402

from app import gateway  # noqa: E402
from app.main import app  # noqa: E402

LOG = []


def tool(tool_name, **inp):
    return {"type": "tool_use", "id": f"tu_{tool_name}_{len(LOG)}", "name": tool_name, "input": inp}


def last_results(messages):
    last = messages[-1]
    if last["role"] != "user" or isinstance(last["content"], str):
        return ""
    out = []
    for b in last["content"]:
        if b.get("type") == "tool_result":
            c = b.get("content")
            out.append(c if isinstance(c, str) else json.dumps(c))
    return "\n".join(out)


class Scripted:
    name = "scripted"

    async def create(self, body, betas):
        msgs = body["messages"]
        step = sum(1 for m in msgs if m["role"] == "assistant")
        prev = last_results(msgs)
        LOG.append({"step": step, "prev": prev[:400]})
        if step == 0:
            content = [
                tool("update_plan", steps=[{"text": "Find WhatsApp", "done": False}, {"text": "Read unread chats", "done": False}, {"text": "Draft replies", "done": False}]),
                tool("list_tabs"),
            ]
        elif step == 1:
            tab = re.search(r"^(\d+)(?: \(current\))?: .*web\.whatsapp\.com", prev, re.M)
            content = [tool("switch_tab", tab_id=int(tab.group(1)), label="Switch to WhatsApp")]
        elif step == 2:
            content = [tool("read_inbox", unread_only=True)]
        elif step == 3:
            assert "Kouvas (2 unread)" in prev, prev
            content = [tool("read_conversation", name="Kouvas", label="Open Kouvas's chat")]
        elif step == 4:
            assert "How much for 50 kg T-bone" in prev, prev
            content = [tool("find", query="send")]
        elif step == 5:
            ref = re.search(r"\[(e\d+)\] button \"Send\"", prev).group(1)
            content = [tool("click", ref=ref, label="Press Send")]
        elif step == 6:
            assert "declined" in prev, prev
            content = [
                tool("draft_message", contact_name="Kouvas", channel="whatsapp", kind="reply", language="Nyanja",
                     text="Muli bwanji Kouvas. T-bone ndi K120/kg, 50 kg ndi K6,000. Ndikutumizirani zithunzi tsopano.",
                     their_last_message="Can you send photos?", reason="Asked for 50 kg price and photos"),
                tool("save_contact", name="Kouvas", channel="whatsapp", stage="quoted", language="Nyanja",
                     last_they_said="Can you send photos?", last_we_asked="Quoted K120/kg for 50 kg",
                     next_step="Send photos and confirm delivery day", next_date="2026-10-13",
                     cash_expected=6000, currency="ZMW", summary="Asked for 50 kg T-bone; quoted K120/kg"),
                tool("update_plan", steps=[{"text": "Find WhatsApp", "done": True}, {"text": "Read unread chats", "done": True}, {"text": "Draft replies", "done": True}]),
            ]
        else:
            assert "Queued for the user's approval" in prev, prev
            return self._msg(body, [{"type": "text", "text": "Drafted 1 reply for approval. Kouvas wants photos."}], "end_turn")
        return self._msg(body, content, "tool_use")

    def _msg(self, body, content, stop):
        return {"id": f"msg_{len(LOG)}", "type": "message", "role": "assistant", "model": body["model"], "content": content,
                "stop_reason": stop, "stop_sequence": None, "usage": {"input_tokens": 1500, "output_tokens": 120}}


gateway.set_providers([Scripted()])

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8799")), log_level="warning")
