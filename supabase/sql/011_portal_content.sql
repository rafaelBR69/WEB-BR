-- Fase 4B modulo portal:
-- - contenido por promocion, idioma y audiencia
-- - tracking de leads externos (atribucion/duplicados)
-- - solicitudes de visita
-- - estado de colaboracion/comision
-- - extension de documentos para visibilidad portal

alter table crm.documents
add column if not exists portal_visibility text not null default 'crm_only';

alter table crm.documents
add column if not exists project_property_id uuid references crm.properties(id) on delete set null;

alter table crm.documents
add column if not exists portal_is_published boolean not null default false;

alter table crm.documents
add column if not exists portal_published_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_portal_visibility_chk'
      and conrelid = 'crm.documents'::regclass
  ) then
    alter table crm.documents
    add constraint documents_portal_visibility_chk
    check (portal_visibility in ('crm_only', 'agent', 'client', 'both'));
  end if;
end;
$$;

create table if not exists crm.portal_content_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  project_property_id uuid not null references crm.properties(id) on delete cascade,
  language text not null check (char_length(btrim(language)) between 2 and 10),
  audience text not null check (audience in ('agent', 'client', 'both')),
  section_key text not null check (char_length(btrim(section_key)) >= 2),
  title text,
  body_markdown text,
  media jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.portal_lead_tracking (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  lead_id uuid not null references crm.leads(id) on delete cascade,
  project_property_id uuid not null references crm.properties(id) on delete cascade,
  portal_account_id uuid not null references crm.portal_accounts(id) on delete cascade,
  attribution_status text not null default 'pending_review' check (
    attribution_status in (
      'pending_review',
      'attributed',
      'rejected_duplicate',
      'existing_client',
      'manual_review'
    )
  ),
  duplicate_of_lead_id uuid references crm.leads(id) on delete set null,
  dispute_until timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, lead_id),
  check (duplicate_of_lead_id is null or duplicate_of_lead_id <> lead_id)
);

create table if not exists crm.portal_visit_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  lead_id uuid not null references crm.leads(id) on delete cascade,
  project_property_id uuid not null references crm.properties(id) on delete cascade,
  portal_account_id uuid not null references crm.portal_accounts(id) on delete cascade,
  request_mode text not null default 'proposal_slots' check (
    request_mode in ('proposal_slots', 'direct_booking')
  ),
  proposed_slots jsonb not null default '[]'::jsonb,
  confirmed_slot timestamptz,
  status text not null default 'requested' check (
    status in ('requested', 'confirmed', 'declined', 'done', 'no_show', 'cancelled')
  ),
  notes text,
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(proposed_slots) = 'array')
);

create table if not exists crm.portal_commission_status (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  lead_id uuid references crm.leads(id) on delete set null,
  deal_id uuid references crm.deals(id) on delete set null,
  project_property_id uuid not null references crm.properties(id) on delete cascade,
  portal_account_id uuid not null references crm.portal_accounts(id) on delete cascade,
  commission_type text not null check (commission_type in ('percent', 'fixed')),
  commission_value numeric(14, 2) not null check (commission_value >= 0),
  currency text not null default 'EUR',
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'paid', 'cancelled')
  ),
  payment_date date,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lead_id is not null or deal_id is not null)
);

create or replace function crm.ensure_portal_document_scope()
returns trigger
language plpgsql
as $$
declare
  linked_project_org_id uuid;
  linked_project_record_type crm.property_record_type;
begin
  if new.portal_visibility <> 'crm_only' and new.project_property_id is null then
    raise exception 'Portal document visibility requires project_property_id';
  end if;

  if new.project_property_id is not null then
    select p.organization_id, p.record_type
      into linked_project_org_id, linked_project_record_type
    from crm.properties p
    where p.id = new.project_property_id;

    if linked_project_org_id is null then
      raise exception 'Portal document project not found: %', new.project_property_id;
    end if;

    if linked_project_org_id <> new.organization_id then
      raise exception 'Organization mismatch between document and portal project';
    end if;

    if linked_project_record_type <> 'project' then
      raise exception 'Portal document project must target crm.properties record_type=project';
    end if;
  end if;

  if new.portal_is_published and new.portal_published_at is null then
    new.portal_published_at := now();
  end if;

  if not new.portal_is_published then
    new.portal_published_at := null;
  end if;

  return new;
end;
$$;

create or replace function crm.ensure_portal_content_block_scope()
returns trigger
language plpgsql
as $$
declare
  linked_project_org_id uuid;
  linked_project_record_type crm.property_record_type;
begin
  select p.organization_id, p.record_type
    into linked_project_org_id, linked_project_record_type
  from crm.properties p
  where p.id = new.project_property_id;

  if linked_project_org_id is null then
    raise exception 'Portal content project not found: %', new.project_property_id;
  end if;

  if linked_project_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal content and project';
  end if;

  if linked_project_record_type <> 'project' then
    raise exception 'Portal content project must target crm.properties record_type=project';
  end if;

  if new.is_published and new.published_at is null then
    new.published_at := now();
  end if;

  if not new.is_published then
    new.published_at := null;
  end if;

  return new;
end;
$$;

create or replace function crm.ensure_portal_lead_tracking_scope()
returns trigger
language plpgsql
as $$
declare
  linked_lead_org_id uuid;
  linked_lead_property_id uuid;
  linked_property_parent_id uuid;
  linked_property_org_id uuid;
  linked_project_org_id uuid;
  linked_project_record_type crm.property_record_type;
  linked_portal_account_org_id uuid;
  linked_duplicate_org_id uuid;
  linked_dispute_window_hours integer;
begin
  select l.organization_id, l.property_id
    into linked_lead_org_id, linked_lead_property_id
  from crm.leads l
  where l.id = new.lead_id;

  if linked_lead_org_id is null then
    raise exception 'Portal lead tracking lead not found: %', new.lead_id;
  end if;

  if linked_lead_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal lead tracking and lead';
  end if;

  select p.organization_id, p.record_type
    into linked_project_org_id, linked_project_record_type
  from crm.properties p
  where p.id = new.project_property_id;

  if linked_project_org_id is null then
    raise exception 'Portal lead tracking project not found: %', new.project_property_id;
  end if;

  if linked_project_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal lead tracking and project';
  end if;

  if linked_project_record_type <> 'project' then
    raise exception 'Portal lead tracking project must target crm.properties record_type=project';
  end if;

  if linked_lead_property_id is not null then
    select p.organization_id, p.parent_property_id
      into linked_property_org_id, linked_property_parent_id
    from crm.properties p
    where p.id = linked_lead_property_id;

    if linked_property_org_id is null then
      raise exception 'Portal lead tracking lead property not found: %', linked_lead_property_id;
    end if;

    if linked_property_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal lead tracking and lead property';
    end if;

    if linked_lead_property_id is distinct from new.project_property_id
      and linked_property_parent_id is distinct from new.project_property_id then
      raise exception 'Lead property does not belong to project_property_id';
    end if;
  end if;

  select pa.organization_id
    into linked_portal_account_org_id
  from crm.portal_accounts pa
  where pa.id = new.portal_account_id;

  if linked_portal_account_org_id is null then
    raise exception 'Portal lead tracking account not found: %', new.portal_account_id;
  end if;

  if linked_portal_account_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal lead tracking and portal account';
  end if;

  select pm.dispute_window_hours
    into linked_dispute_window_hours
  from crm.portal_memberships pm
  where pm.portal_account_id = new.portal_account_id
    and pm.project_property_id = new.project_property_id
    and pm.organization_id = new.organization_id
    and pm.status = 'active'
  limit 1;

  if linked_dispute_window_hours is null then
    raise exception 'Portal lead tracking requires active portal_membership for account/project';
  end if;

  if new.duplicate_of_lead_id is not null then
    select l.organization_id
      into linked_duplicate_org_id
    from crm.leads l
    where l.id = new.duplicate_of_lead_id;

    if linked_duplicate_org_id is null then
      raise exception 'Portal lead tracking duplicate lead not found: %', new.duplicate_of_lead_id;
    end if;

    if linked_duplicate_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal lead tracking and duplicate_of_lead_id';
    end if;
  end if;

  if new.attribution_status = 'pending_review' and new.dispute_until is null then
    new.dispute_until := now() + make_interval(hours => linked_dispute_window_hours);
  end if;

  return new;
end;
$$;

create or replace function crm.ensure_portal_visit_request_scope()
returns trigger
language plpgsql
as $$
declare
  linked_lead_org_id uuid;
  linked_project_org_id uuid;
  linked_project_record_type crm.property_record_type;
  linked_portal_account_org_id uuid;
  active_membership_exists boolean;
  slot_count integer;
begin
  select l.organization_id
    into linked_lead_org_id
  from crm.leads l
  where l.id = new.lead_id;

  if linked_lead_org_id is null then
    raise exception 'Portal visit request lead not found: %', new.lead_id;
  end if;

  if linked_lead_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal visit request and lead';
  end if;

  select p.organization_id, p.record_type
    into linked_project_org_id, linked_project_record_type
  from crm.properties p
  where p.id = new.project_property_id;

  if linked_project_org_id is null then
    raise exception 'Portal visit request project not found: %', new.project_property_id;
  end if;

  if linked_project_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal visit request and project';
  end if;

  if linked_project_record_type <> 'project' then
    raise exception 'Portal visit request project must target crm.properties record_type=project';
  end if;

  select pa.organization_id
    into linked_portal_account_org_id
  from crm.portal_accounts pa
  where pa.id = new.portal_account_id;

  if linked_portal_account_org_id is null then
    raise exception 'Portal visit request account not found: %', new.portal_account_id;
  end if;

  if linked_portal_account_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal visit request and portal account';
  end if;

  select exists (
    select 1
    from crm.portal_memberships pm
    where pm.portal_account_id = new.portal_account_id
      and pm.project_property_id = new.project_property_id
      and pm.organization_id = new.organization_id
      and pm.status = 'active'
  )
  into active_membership_exists;

  if not active_membership_exists then
    raise exception 'Portal visit request requires active portal_membership for account/project';
  end if;

  if jsonb_typeof(new.proposed_slots) <> 'array' then
    raise exception 'Portal visit request proposed_slots must be a JSON array';
  end if;

  slot_count := jsonb_array_length(new.proposed_slots);

  if new.request_mode = 'proposal_slots' and (slot_count < 2 or slot_count > 3) then
    raise exception 'Portal visit request proposal_slots mode allows 2 to 3 slots';
  end if;

  if new.status = 'confirmed' and new.confirmed_slot is null then
    raise exception 'Portal visit request status=confirmed requires confirmed_slot';
  end if;

  if new.status in ('done', 'no_show') and new.confirmed_slot is null then
    raise exception 'Portal visit request done/no_show requires confirmed_slot';
  end if;

  return new;
end;
$$;

create or replace function crm.ensure_portal_commission_scope()
returns trigger
language plpgsql
as $$
declare
  linked_project_org_id uuid;
  linked_project_record_type crm.property_record_type;
  linked_lead_org_id uuid;
  linked_deal_org_id uuid;
  linked_portal_account_org_id uuid;
  membership_exists boolean;
begin
  select p.organization_id, p.record_type
    into linked_project_org_id, linked_project_record_type
  from crm.properties p
  where p.id = new.project_property_id;

  if linked_project_org_id is null then
    raise exception 'Portal commission project not found: %', new.project_property_id;
  end if;

  if linked_project_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal commission and project';
  end if;

  if linked_project_record_type <> 'project' then
    raise exception 'Portal commission project must target crm.properties record_type=project';
  end if;

  select pa.organization_id
    into linked_portal_account_org_id
  from crm.portal_accounts pa
  where pa.id = new.portal_account_id;

  if linked_portal_account_org_id is null then
    raise exception 'Portal commission account not found: %', new.portal_account_id;
  end if;

  if linked_portal_account_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal commission and portal account';
  end if;

  select exists (
    select 1
    from crm.portal_memberships pm
    where pm.portal_account_id = new.portal_account_id
      and pm.project_property_id = new.project_property_id
      and pm.organization_id = new.organization_id
  )
  into membership_exists;

  if not membership_exists then
    raise exception 'Portal commission requires existing portal_membership for account/project';
  end if;

  if new.lead_id is not null then
    select l.organization_id
      into linked_lead_org_id
    from crm.leads l
    where l.id = new.lead_id;

    if linked_lead_org_id is null then
      raise exception 'Portal commission lead not found: %', new.lead_id;
    end if;

    if linked_lead_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal commission and lead';
    end if;
  end if;

  if new.deal_id is not null then
    select d.organization_id
      into linked_deal_org_id
    from crm.deals d
    where d.id = new.deal_id;

    if linked_deal_org_id is null then
      raise exception 'Portal commission deal not found: %', new.deal_id;
    end if;

    if linked_deal_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal commission and deal';
    end if;
  end if;

  if new.commission_type = 'percent' and new.commission_value > 100 then
    raise exception 'Portal commission percent value must be <= 100';
  end if;

  if new.status = 'paid' and new.payment_date is null then
    new.payment_date := current_date;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_documents_portal_validate_scope on crm.documents;
create trigger trg_documents_portal_validate_scope
before insert or update on crm.documents
for each row execute procedure crm.ensure_portal_document_scope();

drop trigger if exists trg_portal_content_blocks_validate_scope on crm.portal_content_blocks;
create trigger trg_portal_content_blocks_validate_scope
before insert or update on crm.portal_content_blocks
for each row execute procedure crm.ensure_portal_content_block_scope();

drop trigger if exists trg_portal_content_blocks_updated_at on crm.portal_content_blocks;
create trigger trg_portal_content_blocks_updated_at
before update on crm.portal_content_blocks
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_portal_lead_tracking_validate_scope on crm.portal_lead_tracking;
create trigger trg_portal_lead_tracking_validate_scope
before insert or update on crm.portal_lead_tracking
for each row execute procedure crm.ensure_portal_lead_tracking_scope();

drop trigger if exists trg_portal_lead_tracking_updated_at on crm.portal_lead_tracking;
create trigger trg_portal_lead_tracking_updated_at
before update on crm.portal_lead_tracking
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_portal_visit_requests_validate_scope on crm.portal_visit_requests;
create trigger trg_portal_visit_requests_validate_scope
before insert or update on crm.portal_visit_requests
for each row execute procedure crm.ensure_portal_visit_request_scope();

drop trigger if exists trg_portal_visit_requests_updated_at on crm.portal_visit_requests;
create trigger trg_portal_visit_requests_updated_at
before update on crm.portal_visit_requests
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_portal_commission_status_validate_scope on crm.portal_commission_status;
create trigger trg_portal_commission_status_validate_scope
before insert or update on crm.portal_commission_status
for each row execute procedure crm.ensure_portal_commission_scope();

drop trigger if exists trg_portal_commission_status_updated_at on crm.portal_commission_status;
create trigger trg_portal_commission_status_updated_at
before update on crm.portal_commission_status
for each row execute procedure crm.set_updated_at();

create index if not exists idx_documents_portal_visibility
  on crm.documents (organization_id, portal_visibility, portal_is_published);
create index if not exists idx_documents_portal_project
  on crm.documents (organization_id, project_property_id);

create index if not exists idx_portal_content_blocks_org_project_published
  on crm.portal_content_blocks (organization_id, project_property_id, is_published);
create index if not exists idx_portal_content_blocks_org_language_audience
  on crm.portal_content_blocks (organization_id, language, audience);
create index if not exists idx_portal_content_blocks_org_section
  on crm.portal_content_blocks (organization_id, section_key, sort_order);

create index if not exists idx_portal_lead_tracking_org_project_status
  on crm.portal_lead_tracking (organization_id, project_property_id, attribution_status);
create index if not exists idx_portal_lead_tracking_org_account
  on crm.portal_lead_tracking (organization_id, portal_account_id);
create index if not exists idx_portal_lead_tracking_org_dispute_until
  on crm.portal_lead_tracking (organization_id, dispute_until);

create index if not exists idx_portal_visit_requests_org_project_status
  on crm.portal_visit_requests (organization_id, project_property_id, status);
create index if not exists idx_portal_visit_requests_org_account
  on crm.portal_visit_requests (organization_id, portal_account_id);
create index if not exists idx_portal_visit_requests_org_confirmed_slot
  on crm.portal_visit_requests (organization_id, confirmed_slot);

create index if not exists idx_portal_commission_status_org_project_status
  on crm.portal_commission_status (organization_id, project_property_id, status);
create index if not exists idx_portal_commission_status_org_account
  on crm.portal_commission_status (organization_id, portal_account_id);
create index if not exists idx_portal_commission_status_org_payment_date
  on crm.portal_commission_status (organization_id, payment_date);

grant select, insert, update, delete on table crm.portal_content_blocks to authenticated, service_role;
grant select, insert, update, delete on table crm.portal_lead_tracking to authenticated, service_role;
grant select, insert, update, delete on table crm.portal_visit_requests to authenticated, service_role;
grant select, insert, update, delete on table crm.portal_commission_status to authenticated, service_role;
grant select on table crm.documents to authenticated, service_role;

grant execute on function crm.ensure_portal_document_scope() to authenticated, service_role;
grant execute on function crm.ensure_portal_content_block_scope() to authenticated, service_role;
grant execute on function crm.ensure_portal_lead_tracking_scope() to authenticated, service_role;
grant execute on function crm.ensure_portal_visit_request_scope() to authenticated, service_role;
grant execute on function crm.ensure_portal_commission_scope() to authenticated, service_role;
