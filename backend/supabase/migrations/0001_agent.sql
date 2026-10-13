-- AirDial Agent: communication management tables for Supabase Postgres.
-- Matches backend/app/db.py. The backend creates these automatically on
-- SQLite; on Supabase apply this migration and turn on RLS.

create table if not exists contacts (
  user_id    text not null,
  id         text not null,
  name       text not null,
  channel    text not null,
  stage      text not null default 'new',
  next_date  text,
  doc        jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists contacts_due on contacts (user_id, next_date);

create table if not exists approvals (
  user_id      text not null,
  id           text not null,
  status       text not null,
  kind         text not null,
  contact_name text not null,
  sent_at      text,
  doc          jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists approvals_status on approvals (user_id, status);

create table if not exists audit_log (
  user_id text not null,
  id      text not null,
  at      text not null,
  tier    text not null,
  action  text not null,
  outcome text not null,
  doc     jsonb not null,
  primary key (user_id, id)
);
create index if not exists audit_at on audit_log (user_id, at desc);

create table if not exists model_usage (
  pk            bigserial primary key,
  user_id       text not null,
  at            timestamptz not null default now(),
  model         text not null,
  input_tokens  integer not null,
  output_tokens integer not null,
  cost_usd      double precision not null
);
create index if not exists model_usage_user_at on model_usage (user_id, at);

create table if not exists whatsapp_events (
  pk      bigserial primary key,
  at      timestamptz not null default now(),
  payload jsonb not null
);

-- The backend connects with the service role; block direct client access.
alter table contacts        enable row level security;
alter table approvals       enable row level security;
alter table audit_log       enable row level security;
alter table model_usage     enable row level security;
alter table whatsapp_events enable row level security;
