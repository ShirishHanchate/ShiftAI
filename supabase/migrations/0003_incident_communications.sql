-- ShiftSync AI — incident communications (emails, chat messages, ticket comments).
-- Used by Auto Handover and the agent as additional, read-only context.
-- All seeded rows are FICTIONAL sample data.

create table if not exists public.incident_communications (
  id              bigint generated always as identity primary key,
  incident_id     text not null references public.incidents (id) on delete cascade,
  channel         text not null check (channel in ('email', 'chat', 'ticket_comment')),
  author          text not null,
  subject         text,
  body            text not null,
  sent_at         timestamptz not null,
  is_sample_data  boolean not null default false,
  -- Natural key so the seed script is idempotent.
  dedupe_key      text not null unique
);

create index if not exists incident_comms_incident_idx on public.incident_communications (incident_id, sent_at desc);

alter table public.incident_communications enable row level security;
-- No policies: only the server (service-role key) can read or write.
