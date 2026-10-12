-- ShiftSync AI — Phase 3: persisted handovers, incident audit trail and an
-- atomic confirmation function. Run after 0001_incidents.sql.


-- ---------------------------------------------------------------------------
-- Handovers
-- ---------------------------------------------------------------------------
create table if not exists public.handovers (
  id                    uuid primary key default gen_random_uuid(),
  -- Client-generated key: retries of the same confirmation never apply twice.
  idempotency_key       text not null unique,
  -- SHA-256 of the confirmation request; a reused key with a different body is rejected.
  request_hash          text not null,
  original_transcript   text not null,
  edited_transcript     text,             -- null when identical to the original
  outgoing_shift        text not null,
  incoming_shift        text not null,
  submitted_by          text,
  status                text not null check (status in ('confirmed', 'no_changes')),
  incident_ids          text[] not null default '{}',  -- every incident covered by the review
  approved_incident_ids text[] not null default '{}',
  rejected_incident_ids text[] not null default '{}',
  -- Per-incident review outcome: applied changes, AI recommendations, missing info, rejections.
  review                jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists handovers_created_at_idx on public.handovers (created_at desc);

-- ---------------------------------------------------------------------------
-- Audit trail of confirmed incident changes
-- ---------------------------------------------------------------------------
create table if not exists public.incident_audit_log (
  id                  bigint generated always as identity primary key,
  incident_id         text not null references public.incidents (id) on delete cascade,
  handover_id         uuid not null references public.handovers (id) on delete cascade,
  created_at          timestamptz not null default now(),
  source              text not null default 'handover' check (source in ('handover', 'manual')),
  changed_fields      text[] not null,
  previous_values     jsonb not null,
  new_values          jsonb not null,
  confirmation_status text not null default 'confirmed' check (confirmation_status in ('confirmed')),
  unique (incident_id, handover_id)
);

create index if not exists incident_audit_incident_idx on public.incident_audit_log (incident_id, created_at desc);

alter table public.handovers enable row level security;
alter table public.incident_audit_log enable row level security;
-- No policies: only the server (service-role key) can read or write.

-- ---------------------------------------------------------------------------
-- confirm_handover: applies every approved incident update in ONE transaction.
--
-- p_handover: { idempotency_key, request_hash, original_transcript, edited_transcript,
--               outgoing_shift, incoming_shift, submitted_by, status, incident_ids,
--               approved_incident_ids, rejected_incident_ids, review }
-- p_updates:  [{ incident_id, expected_updated_at, changed_fields, previous_values,
--                new_values, next: { status, summary, owner, next_update_at,
--                actions_completed, pending_actions, blockers, history_entry } }]
--
-- Raises (and therefore rolls back everything) on:
--   SS409 IDEMPOTENCY_CONFLICT  same key, different request
--   SS404 UNKNOWN_INCIDENT      incident does not exist
--   SS412 STALE_INCIDENT        incident changed since the reviewer loaded it
-- ---------------------------------------------------------------------------
create or replace function public.confirm_handover(p_handover jsonb, p_updates jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing   public.handovers%rowtype;
  v_handover   uuid;
  v_update     jsonb;
  v_next       jsonb;
  v_current    public.incidents%rowtype;
  v_now        timestamptz := date_trunc('milliseconds', now());
  v_applied    int := 0;
begin
  select * into v_existing from public.handovers where idempotency_key = p_handover ->> 'idempotency_key';
  if found then
    if v_existing.request_hash <> p_handover ->> 'request_hash' then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'SS409';
    end if;
    return jsonb_build_object('handover_id', v_existing.id, 'replayed', true, 'applied', 0);
  end if;

  insert into public.handovers (
    idempotency_key, request_hash, original_transcript, edited_transcript, outgoing_shift,
    incoming_shift, submitted_by, status, incident_ids, approved_incident_ids,
    rejected_incident_ids, review, created_at
  ) values (
    p_handover ->> 'idempotency_key',
    p_handover ->> 'request_hash',
    p_handover ->> 'original_transcript',
    nullif(p_handover ->> 'edited_transcript', ''),
    p_handover ->> 'outgoing_shift',
    p_handover ->> 'incoming_shift',
    nullif(p_handover ->> 'submitted_by', ''),
    p_handover ->> 'status',
    coalesce(array(select jsonb_array_elements_text(p_handover -> 'incident_ids')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_handover -> 'approved_incident_ids')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_handover -> 'rejected_incident_ids')), '{}'),
    coalesce(p_handover -> 'review', '[]'::jsonb),
    v_now
  ) returning id into v_handover;

  for v_update in select * from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) loop
    -- Row lock serialises concurrent confirmations touching the same incident.
    select * into v_current from public.incidents where id = v_update ->> 'incident_id' for update;
    if not found then
      raise exception 'UNKNOWN_INCIDENT:%', v_update ->> 'incident_id' using errcode = 'SS404';
    end if;
    -- Optimistic concurrency: the reviewer's view must still be current.
    if date_trunc('milliseconds', v_current.updated_at) <> (v_update ->> 'expected_updated_at')::timestamptz then
      raise exception 'STALE_INCIDENT:%', v_current.id using errcode = 'SS412';
    end if;

    v_next := v_update -> 'next';
    update public.incidents set
      status            = v_next ->> 'status',
      summary           = v_next ->> 'summary',
      owner             = v_next ->> 'owner',
      next_update_at    = (v_next ->> 'next_update_at')::timestamptz,
      actions_completed = v_next -> 'actions_completed',
      pending_actions   = v_next -> 'pending_actions',
      blockers          = v_next -> 'blockers',
      update_history    = update_history || jsonb_build_array(
                            (v_next -> 'history_entry') || jsonb_build_object('at', to_jsonb(v_now), 'handoverId', v_handover)),
      updated_at        = v_now
    where id = v_current.id;

    insert into public.incident_audit_log (
      incident_id, handover_id, created_at, source, changed_fields, previous_values, new_values, confirmation_status
    ) values (
      v_current.id,
      v_handover,
      v_now,
      'handover',
      coalesce(array(select jsonb_array_elements_text(v_update -> 'changed_fields')), '{}'),
      v_update -> 'previous_values',
      v_update -> 'new_values',
      'confirmed'
    );
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('handover_id', v_handover, 'replayed', false, 'applied', v_applied);
end;
$$;

-- Only the server may call this function (service role bypasses these grants).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.confirm_handover(jsonb, jsonb) from public, anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.confirm_handover(jsonb, jsonb) to service_role';
  end if;
end $$;
