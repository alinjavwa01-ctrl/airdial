# AirDial Agent

A Chrome side-panel agent that works in your browser the way Claude in Chrome does. It reads pages, clicks, types, scrolls, chooses from dropdowns, switches tabs, takes screenshots and researches the web. It uses real mouse and keyboard input through the Chrome DevTools protocol, so it works on sites that ignore scripted events. On top of that it manages communications: it drafts replies into an approval queue, waits for your approval before anything goes out in your name, keeps notes on each contact and follows up on time.

It is built separately from airdial.co and is meant to merge into it. It talks to AirDial only through the AirDial service in `backend/`.

```
extension/   Chrome MV3 extension (TypeScript, React, WXT): the browser agent and side panel
backend/     AirDial service (FastAPI): model gateway + communication management
docs/        Screenshots from the end-to-end run
```

![Approval queue](docs/screenshots/05-approval-queue.png)

## How it works

```
 side panel (React)                          AirDial service (FastAPI)
 ┌───────────────────────────┐  /v1/messages  ┌────────────────────────────────┐
 │ agent loop                ├───────────────►│ gateway: mode "best" / "fast"  │──► Claude (primary)
 │  plan → read → act        │  mode only     │  provider failover, allowance, │──► OpenAI / others (backup)
 │  → approval gate → report │                │  cost metering, AirDial errors │
 │ approvals, contacts,      │  /v1/sync      │ contacts, approvals, follow-ups│
 │ follow-ups, daily summary ├───────────────►│ audit log, daily summary       │
 └──────┬──────────┬─────────┘                └────────────────────────────────┘
        │ scripting│ debugger (CDP)
 ┌──────▼──────────▼─────────┐
 │ any site the user allowed │  page text + numbered elements; real clicks, typing,
 │                           │  keys, scroll, screenshots; "agent is working" banner
 └───────────────────────────┘
```

**Chrome actions.** The agent's browser tools are:

- `read_page` and `find`: page text plus numbered elements it can act on.
- `click`: by element ref, or at x,y coordinates from a screenshot.
- `hover`, `type_text`, `select_option`.
- `press_key`: single keys and combos such as `ctrl+a`.
- `scroll`.
- `navigate`, `open_tab`, `switch_tab`, `list_tabs`, `wait`.
- `screenshot`: coordinates in it match click coordinates.

Clicking, typing, key presses and screenshots go through `chrome.debugger`. Chrome shows its "started debugging this browser" bar while a task runs. If DevTools already holds a tab, the agent falls back to synthetic events. The agent reads text first because it costs less, and takes a screenshot only when layout or images matter. Each action shows a one-line label in the panel and in a banner on the page with a Stop button.

**Communication management.**
- `draft_message` puts a message in the approval queue, or sends it straight away if you turned on auto-send for that kind of message.
- `save_contact` and `find_contacts` keep per-contact memory: stage, what they said, what we asked, the next step and its date, and expected cash.
- An approved message goes out through the AirDial WhatsApp Business API when your number is on it. Otherwise the agent opens the conversation and sends the approved text in the browser. Only that one send is pre-approved.
- Pacing applies to every send: one new contact every 2 minutes, and a daily cap per contact.

**Safety tiers (PRD).**
- **Free:** reading, summarising, drafting and updating memory run without asking.
- **Approve:** sending, posting, submitting a form, and Enter in a text box stop and ask in the panel.
- **Never:** the agent won't type into password or card fields, or type text that looks like a card number or password. It won't pay, transfer, delete chats or accept terms.
- Text from pages and messages is treated as data, never as instructions.
- The extension has access to no sites by default. You allow sites one at a time, or turn on "Allow on all sites".
- Every action goes into an audit log you can export.

**Models and modes.** Customers choose a mode, Best or Fast, and never see a vendor or model name. The AirDial service maps each mode to a model for each provider. Today that is Claude Opus 5.5 for Best and Claude Sonnet 5.5 for Fast. OpenAI is wired in as a backup through an adapter, and other providers can be added. The service fails over on provider-side problems (billing, keys, rate limits, outages) and logs the details for the AirDial team. Customers only ever see AirDial wording, for example "AirDial Agent is busy right now." For development there's a Developer setting to run the panel on your own Anthropic key.

## Run it

**AirDial service**

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env   # set ANTHROPIC_API_KEY (and optionally OPENAI_API_KEY + MODEL_*_OPENAI), AIRDIAL_TOKENS
set -a; . ./.env; set +a
.venv/bin/uvicorn app.main:app --port 8787
```

For production, point `DATABASE_URL` at Supabase Postgres and apply `backend/supabase/migrations/0001_agent.sql`.

**Extension**

```bash
cd extension
npm install
WXT_AIRDIAL_API_URL=https://<your AirDial service> npm run build   # defaults to http://localhost:8787
```

In Chrome, open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick `extension/.output/chrome-mv3`. Click the toolbar icon or press Alt+A. Sign in with a token from `AIRDIAL_TOKENS`.

## Tests

```bash
cd extension && npm test          # safety tiers, pacing, page reading
cd extension && npm run e2e       # real Chromium + built extension + fixture site + AirDial service with a scripted model
cd backend && .venv/bin/python -m pytest -q   # modes, failover, AirDial-only errors, OpenAI translation, allowance, sync, follow-ups
ANTHROPIC_API_KEY=... npm run e2e:live         # (extension/) a real-model run in developer mode
```

The fixture site only reacts to trusted input, so the end-to-end run proves the actions are real. It covers:
- a click at screenshot coordinates;
- a Send click denied at the approval gate;
- a draft approved from the queue and sent by the agent with real typing;
- a form filled with a dropdown, with the password field blocked and the submit approved;
- a simulated provider outage that shows only AirDial wording;
- contact memory, the daily summary and the sync to the service.

## Status

Built:
- PRD milestones 1–2.
- Most of milestone 3: contact memory, next-step dates, the "due today" list and a morning notification.
- General browser tasks and research.
- The AirDial WhatsApp API send path.
- The daily summary.
- Every screen except calls.

Not yet:
- Voice calls.
- Google Sheets sync.
- Backend scheduling, so sends can run while the panel is closed.
- Supabase Auth sign-in. It uses static tokens for now.
- Billing.
- The Chrome Web Store listing.

The palette follows the PRD (dark wine and pink). Brand tokens live in `extension/src/ui/styles.css` and `extension/src/brand.ts`, ready to switch to the airdial.co brand kit.
