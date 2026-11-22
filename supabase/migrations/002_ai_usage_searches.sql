-- Networking Studio · migration 002 (Build 3): count Google searches per month.
-- Google gives 5,000 grounded searches per month for free; the app only prices the ones above that.
-- Run once in Supabase → SQL Editor. Safe to run again.
alter table public.ai_usage add column if not exists searches integer not null default 0;
