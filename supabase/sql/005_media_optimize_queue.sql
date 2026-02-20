-- Background queue for CRM media optimization.
-- Runs alongside scripts/optimize-crm-property-media.mjs.

create table if not exists crm.media_optimize_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  property_id uuid not null references crm.properties(id) on delete cascade,
  legacy_code text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  priority integer not null default 100 check (priority between 1 and 1000),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  requested_at timestamptz not null default now(),
  run_after timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  worker_id text,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  last_report_path text,
  last_summary jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_media_optimize_jobs_status_schedule
  on crm.media_optimize_jobs (status, run_after, priority desc, requested_at asc);

create index if not exists idx_media_optimize_jobs_org_requested
  on crm.media_optimize_jobs (organization_id, requested_at desc);

create unique index if not exists uq_media_optimize_jobs_active_property
  on crm.media_optimize_jobs (organization_id, property_id)
  where status in ('queued', 'processing');

drop trigger if exists trg_media_optimize_jobs_updated_at on crm.media_optimize_jobs;
create trigger trg_media_optimize_jobs_updated_at
before update on crm.media_optimize_jobs
for each row execute procedure crm.set_updated_at();

create or replace function crm.enqueue_media_optimize_job(
  p_organization_id uuid,
  p_property_id uuid,
  p_legacy_code text default null,
  p_reason text default null,
  p_priority integer default 100,
  p_payload jsonb default '{}'::jsonb
)
returns crm.media_optimize_jobs
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_job crm.media_optimize_jobs%rowtype;
  v_priority integer;
begin
  if p_organization_id is null or p_property_id is null then
    raise exception 'organization_id and property_id are required';
  end if;

  v_priority := greatest(1, least(1000, coalesce(p_priority, 100)));

  perform pg_advisory_xact_lock(hashtext(p_organization_id::text || ':' || p_property_id::text));

  update crm.media_optimize_jobs
     set requested_at = now(),
         run_after = now(),
         priority = greatest(priority, v_priority),
         legacy_code = coalesce(nullif(trim(p_legacy_code), ''), legacy_code),
         reason = coalesce(nullif(trim(p_reason), ''), reason),
         payload = coalesce(payload, '{}'::jsonb) || coalesce(p_payload, '{}'::jsonb),
         updated_at = now()
   where organization_id = p_organization_id
     and property_id = p_property_id
     and status in ('queued', 'processing')
   returning * into v_job;

  if found then
    return v_job;
  end if;

  insert into crm.media_optimize_jobs (
    organization_id,
    property_id,
    legacy_code,
    status,
    priority,
    max_attempts,
    requested_at,
    run_after,
    reason,
    payload
  )
  values (
    p_organization_id,
    p_property_id,
    nullif(trim(p_legacy_code), ''),
    'queued',
    v_priority,
    3,
    now(),
    now(),
    nullif(trim(p_reason), ''),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning * into v_job;

  return v_job;
end;
$$;

create or replace function crm.dequeue_media_optimize_job(
  p_worker_id text default null
)
returns crm.media_optimize_jobs
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_job crm.media_optimize_jobs%rowtype;
begin
  select q.*
    into v_job
  from crm.media_optimize_jobs q
  where q.status = 'queued'
    and q.attempts < q.max_attempts
    and (q.run_after is null or q.run_after <= now())
  order by q.priority desc, q.requested_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update crm.media_optimize_jobs
     set status = 'processing',
         attempts = attempts + 1,
         started_at = now(),
         finished_at = null,
         worker_id = coalesce(nullif(trim(p_worker_id), ''), worker_id),
         last_error = null,
         updated_at = now()
   where id = v_job.id
   returning * into v_job;

  return v_job;
end;
$$;

grant all on table crm.media_optimize_jobs to service_role;
grant execute on function crm.enqueue_media_optimize_job(uuid, uuid, text, text, integer, jsonb) to authenticated, service_role;
grant execute on function crm.dequeue_media_optimize_job(text) to authenticated, service_role;

alter table crm.media_optimize_jobs enable row level security;

drop policy if exists org_scoped_media_optimize_jobs on crm.media_optimize_jobs;
create policy org_scoped_media_optimize_jobs on crm.media_optimize_jobs
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));
