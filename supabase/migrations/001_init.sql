-- Networking Studio · database schema v1 (Build 3)
-- Run once in Supabase → SQL Editor. Safe to run again (IF NOT EXISTS).
--
-- Security model:
-- * Only the app's server talks to the database, with the SECRET key (kept in app/.env and in Render, never in the browser).
-- * Row Level Security is ON for every table and there are NO policies, so the public/publishable key
--   (anon or authenticated role) can't read, insert, update or delete anything.
-- * Rows are keyed by a SHA-256 hash of the user's email, never the email itself.
-- * Google tokens and sessions are stored ENCRYPTED (AES-256-GCM) by the server.

-- App data per account: profile, contacts, AI briefs, classifications, corrections…
create table if not exists public.user_state (
  user_key   text primary key,               -- sha256(email)
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Signed-in browser sessions (the cookie value is hashed; data is encrypted).
create table if not exists public.app_sessions (
  sid_hash   text primary key,               -- sha256(session cookie)
  user_key   text not null,                  -- sha256(email)
  data_enc   text not null,                  -- encrypted session (user name + short-lived Google tokens)
  updated_at timestamptz not null default now()
);
create index if not exists app_sessions_user_key on public.app_sessions (user_key);

-- Google connection per account (refresh token + granted scopes), encrypted. Removed by "Disconnect".
create table if not exists public.google_accounts (
  user_key   text primary key,               -- sha256(email)
  data_enc   text not null,
  updated_at timestamptz not null default now()
);

-- Monthly AI spend for the whole app (the hard budget in server/guard.mjs).
create table if not exists public.ai_usage (
  month      text primary key,               -- '2026-11'
  cost_usd   numeric not null default 0,
  calls      integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Row Level Security on every table, with no policies = no access for public keys.
alter table public.user_state      enable row level security;
alter table public.app_sessions    enable row level security;
alter table public.google_accounts enable row level security;
alter table public.ai_usage        enable row level security;

-- Belt and braces: remove table privileges from the public roles too.
revoke all on public.user_state, public.app_sessions, public.google_accounts, public.ai_usage from anon, authenticated;
