# Deploying AirDial Agent

## 1. AirDial service (Vercel)

The database is ready: Supabase project **airdial-agent** (eu-west-2) with the tables from
`backend/supabase/migrations/0001_agent.sql`, row-level security on, and a dedicated
`airdial_service` login role.

In Vercel (team **Caantin AI**):

1. **Add New → Project → Import** `alinjavwa01-ctrl/airdial`.
2. **Project name:** `airdial-agent-api`. **Root Directory:** `backend`. **Framework Preset:** FastAPI.
3. **Environment Variables:** paste the values from the private `airdial-agent-vercel-env.txt`
   (DATABASE_URL, SUPABASE_URL, AIRDIAL_PROVIDERS, AIRDIAL_MONTHLY_COST_CAP_USD, AIRDIAL_TOKENS,
   ANTHROPIC_API_KEY with credits).
4. **Deploy.** Functions run in London (`lhr1`, set in `backend/vercel.json`), next to the database.
5. Check `https://airdial-agent-api.vercel.app/health?deep=1`. It should return
   `{"ok": true, "database": "ok", "providers_ready": {"best": true, "fast": true}}`.
   If `database` shows an error, change the host in `DATABASE_URL` from `aws-0-eu-west-2` to
   `aws-1-eu-west-2` (Supabase › Connect › Transaction pooler shows the exact host).
6. Optional: add the domain `agent-api.airdial.co` under Settings › Domains.

Pushes to the connected branch redeploy automatically.

## 2. Customer sign-in (Supabase Auth)

Email and password sign-in works with Supabase defaults: customers create an account in the
panel and confirm their email. Before launch, in Supabase › Authentication:
- set **Site URL** to `https://airdial.co`;
- add custom SMTP (the built-in sender is rate-limited to a few emails an hour);
- optional: enable Google sign-in with a Google OAuth client.

## 3. Extension (Chrome Web Store)

The release build points at `https://airdial-agent-api.vercel.app`. If the service lives elsewhere:

```bash
cd extension
WXT_AIRDIAL_API_URL=https://agent-api.airdial.co npm run zip
```

Upload `extension/.output/airdial-agent-<version>-chrome.zip` at
https://chrome.google.com/webstore/devconsole (AirDial developer account, one-time $5).
Choose **Unlisted** for the beta and share the store link with customers.
