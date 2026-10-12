-- ShiftSync AI — incidents table
-- Run in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.incidents (
  id                text primary key check (id ~ '^INC-[0-9]{3,6}$'),
  title             text not null,
  description       text not null default '',
  severity          text not null check (severity in ('SEV1','SEV2','SEV3','SEV4')),
  status            text not null check (status in ('Open','Investigating','Monitoring','Resolved')),
  affected_service  text not null,
  summary           text not null default '',
  actions_completed jsonb not null default '[]'::jsonb,  -- string[]
  pending_actions   jsonb not null default '[]'::jsonb,  -- {description, owner, dueAt, status}[]
  blockers          jsonb not null default '[]'::jsonb,  -- string[]
  owner             text,
  next_update_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  update_history    jsonb not null default '[]'::jsonb,  -- {at, author, source, note}[]
  is_sample_data    boolean not null default false
);

create index if not exists incidents_severity_status_idx on public.incidents (severity, status);

-- Row Level Security on, with NO policies: the anon/public key cannot read or
-- write. The app accesses this table only from server-side routes using the
-- service-role (secret) key, which bypasses RLS.
alter table public.incidents enable row level security;
