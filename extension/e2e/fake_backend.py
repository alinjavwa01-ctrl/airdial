"""Runs the real backend with a scripted model, for the browser end-to-end test.

Three scripted conversations, chosen by the task prompt:
  reply   - read the page, real click by ref, real click by coordinates,
            try Send directly (user denies), queue a draft, save the contact
  send    - the follow-up browser task that sends the approved draft
  form    - fill a form with real typing and a dropdown, submit (user allows)
"""

import json
import os
import re
import sys

os.environ.setdefault("AIRDIAL_TOKENS", "e2e-token:e2e")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

import uvicorn  # noqa: E402

from app import gateway  # noqa: E402
from app.main import app  # noqa: E402
from app.providers import ProviderUnavailable  # noqa: E402

HOST = "shop.airdial-e2e.test"


def tool(tool_name, **inp):
    tool.n += 1
    return {"type": "tool_use", "id": f"tu_{tool_name}_{tool.n}", "name": tool_name, "input": inp}


tool.n = 0


def last_results(messages):
    last = messages[-1]
    if last["role"] != "user" or isinstance(last["content"], str):
        return ""
    return "\n".join(
        b["content"] if isinstance(b.get("content"), str) else json.dumps(b.get("content"))
        for b in last["content"]
        if b.get("type") == "tool_result"
    )


def ref(prev, role, name):
    m = re.search(rf'\[(e\d+)\] {role} "{re.escape(name)}', prev)
    assert m, f"no {role} {name!r} in:\n{prev[:1500]}"
    return m.group(1)


def first_prompt(messages):
    c = messages[0]["content"]
    return c if isinstance(c, str) else json.dumps(c)


def find_tab(prev):
    m = re.search(rf"^(\d+)(?: \(current\))?: .*{re.escape(HOST)}", prev, re.M)
    assert m, prev
    return int(m.group(1))


def reply_script(step, prev):
    if step == 0:
        return [tool("update_plan", steps=[{"text": "Read Kouvas's message", "done": False}, {"text": "Draft a reply", "done": False}]), tool("list_tabs")]
    if step == 1:
        return [tool("switch_tab", tab_id=find_tab(prev), label="Switch to the shop")]
    if step == 2:
        return [tool("read_page")]
    if step == 3:
        assert "How much for 50 kg T-bone" in prev, prev
        return [tool("click", x=770, y=120, label="Show the phone number")]
    if step == 4:
        return [tool("find", query="phone")]
    if step == 5:
        return [tool("read_page")]
    if step == 6:
        assert "Phone: +260 97 000 1111" in prev, "coordinate click did not register as real input:\n" + prev[:800]
        return [tool("click", ref=ref(prev, "button", "Send"), label="Press Send")]
    if step == 7:
        assert "declined" in prev, prev
        return [
            tool("draft_message", contact_name="Kouvas", channel="other", kind="reply", language="Nyanja",
                 text="Muli bwanji Kouvas. T-bone ndi K120/kg, 50 kg ndi K6,000. Ndikutumizirani zithunzi tsopano.",
                 their_last_message="How much for 50 kg T-bone? Can you send photos?", reason="Asked for 50 kg price and photos"),
            tool("save_contact", name="Kouvas", channel="other", stage="quoted", language="Nyanja",
                 last_they_said="How much for 50 kg T-bone? Can you send photos?", last_we_asked="Quoted K120/kg for 50 kg",
                 next_step="Send photos and confirm delivery day", next_date="2026-10-13", cash_expected=6000, currency="ZMW",
                 summary="Asked for 50 kg T-bone; quoted K120/kg"),
        ]
    assert "Queued for the user's approval" in prev, prev
    return "Drafted 1 reply for approval. Kouvas wants photos."


def send_script(step, prev, prompt):
    text = re.search(r"<message>\n(.*?)\n</message>", prompt, re.S).group(1)
    if step == 0:
        return [tool("list_tabs")]
    if step == 1:
        return [tool("switch_tab", tab_id=find_tab(prev), label="Switch to the shop")]
    if step == 2:
        return [tool("find", query="message")]
    if step == 3:
        return [tool("type_text", ref=ref(prev, "textbox", "Message"), text=text, label="Type the approved reply")]
    if step == 4:
        return [tool("find", query="send")]
    if step == 5:
        return [tool("click", ref=ref(prev, "button", "Send"), label="Send it")]
    if step == 6:
        return [tool("read_page")]
    assert f"Me: {text}" in prev, prev[:1500]
    return "Sent."


def form_script(step, prev):
    if step == 0:
        return [tool("list_tabs")]
    if step == 1:
        return [tool("switch_tab", tab_id=find_tab(prev), label="Switch to the shop")]
    if step == 2:
        return [tool("read_page", elements_only=True)]
    if step == 3:
        return [
            tool("type_text", ref=ref(prev, "textbox", "Name"), text="Njavwa", label="Enter name"),
            tool("type_text", ref=ref(prev, "textbox", "Email"), text="njavwa@example.com", label="Enter email"),
            tool("select_option", ref=ref(prev, "combobox", "Product"), option="Mince", label="Choose Mince"),
            tool("type_text", ref=ref(prev, "textbox", "Your enquiry"), text="Do you deliver to Kabulonga?", label="Write the enquiry"),
            tool("type_text", ref=ref(prev, "textbox", "Password"), text="hunter2", label="Fill password"),
        ]
    if step == 4:
        assert "Blocked by safety rules" in prev, "password typing was not blocked:\n" + prev
        return [tool("click", ref=re.search(r'\[(e\d+)\] button "Submit enquiry"', REFS["form"]).group(1), label="Submit the enquiry")]
    if step == 5:
        return [tool("read_page")]
    assert "Thanks, we will reply soon." in prev, prev[:1200]
    return "Sent the enquiry. They'll reply by email."


REFS = {}


class Scripted:
    name = "scripted"

    def supports(self, mode):
        return mode == "best"

    async def create(self, mode, body):
        msgs = body["messages"]
        step = sum(1 for m in msgs if m["role"] == "assistant")
        prev = last_results(msgs)
        prompt = first_prompt(msgs)
        if "simulate outage" in prompt:
            raise ProviderUnavailable("scripted: Your credit balance is too low to access the API")
        if "Send this exact message" in prompt:
            out = send_script(step, prev, prompt)
        elif "contact form" in prompt:
            if step == 3:
                REFS["form"] = prev
            out = form_script(step, prev)
        else:
            out = reply_script(step, prev)
        if isinstance(out, str):
            return self._msg(body, [{"type": "text", "text": out}], "end_turn")
        return self._msg(body, out, "tool_use")

    def _msg(self, body, content, stop):
        return {"id": f"msg_{tool.n}", "type": "message", "role": "assistant", "model": "scripted", "content": content,
                "stop_reason": stop, "stop_sequence": None, "usage": {"input_tokens": 1500, "output_tokens": 120}}


gateway.set_providers([Scripted()])

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8799")), log_level="warning")
