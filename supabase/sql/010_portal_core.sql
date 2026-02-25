-- Fase 4A modulo portal:
-- - cuentas portal (agentes/clientes) vinculadas a auth.users
-- - invitaciones con codigo hash + expiracion + intentos
-- - membresias por promocion
-- - logs de acceso portal

create table if not exists crm.portal_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references crm.contacts(id) on delete set null,
  client_id uuid references crm.clients(id) on delete set null,
  agency_id uuid references crm.agencies(id) on delete set null,
  role text not null check (
    role in ('portal_agent_admin', 'portal_agent_member', 'portal_client')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'active', 'blocked', 'revoked')
  ),
  last_login_at timestamptz,
  blocked_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, auth_user_id)
);

create table if not exists crm.portal_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  invite_type text not null check (invite_type in ('agent', 'client')),
  role text not null check (
    role in ('portal_agent_admin', 'portal_agent_member', 'portal_client')
  ),
  project_property_id uuid references crm.properties(id) on delete set null,
  code_hash text not null,
  code_last4 text not null check (char_length(code_last4) = 4),
  status text not null default 'pending' check (
    status in ('pending', 'used', 'expired', 'revoked', 'blocked')
  ),
  expires_at timestamptz not null,
  max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  used_at timestamptz,
  revoked_at timestamptz,
  blocked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table if not exists crm.portal_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  portal_account_id uuid not null references crm.portal_accounts(id) on delete cascade,
  project_property_id uuid not null references crm.properties(id) on delete cascade,
  access_scope text not null default 'read' check (
    access_scope in ('read', 'read_write', 'full')
  ),
  status text not null default 'active' check (
    status in ('active', 'paused', 'revoked')
  ),
  dispute_window_hours integer not null default 48 check (dispute_window_hours between 24 and 72),
  permissions jsonb not null default '{}'::jsonb,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portal_account_id, project_property_id)
);

create table if not exists crm.portal_access_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  portal_account_id uuid references crm.portal_accounts(id) on delete set null,
  lead_id uuid references crm.leads(id) on delete set null,
  project_property_id uuid references crm.properties(id) on delete set null,
  email text,
  event_type text not null check (
    event_type in (
      'invite_sent',
      'invite_revoked',
      'signup_ok',
      'signup_fail',
      'login_ok',
      'login_fail',
      'code_fail',
      'blocked',
      'logout',
      'lead_submitted',
      'duplicate_detected',
      'visit_requested',
      'visit_confirmed',
      'commission_updated'
    )
  ),
  ip inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function crm.ensure_portal_account_scope()
returns trigger
language plpgsql
as $$
declare
  linked_org_id uuid;
  linked_agency_client_id uuid;
begin
  if new.contact_id is not null then
    select c.organization_id
      into linked_org_id
    from crm.contacts c
    where c.id = new.contact_id;

    if linked_org_id is null then
      raise exception 'Portal account contact not found: %', new.contact_id;
    end if;

    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal account and contact';
    end if;
  end if;

  if new.client_id is not null then
    select c.organization_id
      into linked_org_id
    from crm.clients c
    where c.id = new.client_id;

    if linked_org_id is null then
      raise exception 'Portal account client not found: %', new.client_id;
    end if;

    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal account and client';
    end if;
  end if;

  if new.agency_id is not null then
    select a.organization_id, a.client_id
      into linked_org_id, linked_agency_client_id
    from crm.agencies a
    where a.id = new.agency_id;

    if linked_org_id is null then
      raise exception 'Portal account agency not found: %', new.agency_id;
    end if;

    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal account and agency';
    end if;

    if new.client_id is not null and linked_agency_client_id <> new.client_id then
      raise exception 'Portal account agency/client mismatch';
    end if;
  end if;

  if new.status = 'revoked' and new.revoked_at is null then
    new.revoked_at := now();
  end if;

  if new.status = 'blocked' and new.blocked_at is null then
    new.blocked_at := now();
  end if;

  return new;
end;
$$;

create or replace function crm.ensure_portal_invite_scope()
returns trigger
language plpgsql
as $$
declare
  linked_project_org_id uuid;
  linked_project_record_type crm.property_record_type;
begin
  if new.invite_type = 'client' and new.role <> 'portal_client' then
    raise exception 'portal invite client type only allows role=portal_client';
  end if;

  if new.invite_type = 'agent' and new.role not in ('portal_agent_admin', 'portal_agent_member') then
    raise exception 'portal invite agent type requires portal_agent_admin or portal_agent_member';
  end if;

  if new.project_property_id is not null then
    select p.organization_id, p.record_type
      into linked_project_org_id, linked_project_record_type
    from crm.properties p
    where p.id = new.project_property_id;

    if linked_project_org_id is null then
      raise exception 'Portal invite project not found: %', new.project_property_id;
    end if;

    if linked_project_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal invite and project';
    end if;

    if linked_project_record_type <> 'project' then
      raise exception 'Portal invite project must target crm.properties record_type=project';
    end if;
  end if;

  if new.attempt_count > new.max_attempts then
    raise exception 'attempt_count cannot exceed max_attempts';
  end if;

  if new.status = 'pending' and new.attempt_count >= new.max_attempts then
    new.status := 'blocked';
  end if;

  if new.status = 'used' and new.used_at is null then
    new.used_at := now();
  end if;

  if new.status = 'revoked' and new.revoked_at is null then
    new.revoked_at := now();
  end if;

  if new.status = 'blocked' and new.blocked_at is null then
    new.blocked_at := now();
  end if;

  if new.status = 'pending' and new.expires_at <= now() then
    new.status := 'expired';
  end if;

  return new;
end;
$$;

create or replace function crm.ensure_portal_membership_scope()
returns trigger
language plpgsql
as $$
declare
  linked_account_org_id uuid;
  linked_account_role text;
  linked_project_org_id uuid;
  linked_project_record_type crm.property_record_type;
begin
  select pa.organization_id, pa.role
    into linked_account_org_id, linked_account_role
  from crm.portal_accounts pa
  where pa.id = new.portal_account_id;

  if linked_account_org_id is null then
    raise exception 'Portal membership account not found: %', new.portal_account_id;
  end if;

  if linked_account_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal membership and account';
  end if;

  select p.organization_id, p.record_type
    into linked_project_org_id, linked_project_record_type
  from crm.properties p
  where p.id = new.project_property_id;

  if linked_project_org_id is null then
    raise exception 'Portal membership project not found: %', new.project_property_id;
  end if;

  if linked_project_org_id <> new.organization_id then
    raise exception 'Organization mismatch between portal membership and project';
  end if;

  if linked_project_record_type <> 'project' then
    raise exception 'Portal membership project must target crm.properties record_type=project';
  end if;

  if linked_account_role = 'portal_client' and new.access_scope = 'full' then
    raise exception 'portal_client cannot use access_scope=full';
  end if;

  if new.status = 'revoked' and new.revoked_at is null then
    new.revoked_at := now();
  end if;

  return new;
end;
$$;

create or replace function crm.ensure_portal_access_log_scope()
returns trigger
language plpgsql
as $$
declare
  linked_org_id uuid;
begin
  if new.portal_account_id is not null then
    select pa.organization_id
      into linked_org_id
    from crm.portal_accounts pa
    where pa.id = new.portal_account_id;

    if linked_org_id is null then
      raise exception 'Portal access log account not found: %', new.portal_account_id;
    end if;

    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal access log and account';
    end if;
  end if;

  if new.lead_id is not null then
    select l.organization_id
      into linked_org_id
    from crm.leads l
    where l.id = new.lead_id;

    if linked_org_id is null then
      raise exception 'Portal access log lead not found: %', new.lead_id;
    end if;

    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal access log and lead';
    end if;
  end if;

  if new.project_property_id is not null then
    select p.organization_id
      into linked_org_id
    from crm.properties p
    where p.id = new.project_property_id;

    if linked_org_id is null then
      raise exception 'Portal access log project not found: %', new.project_property_id;
    end if;

    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between portal access log and project';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_portal_accounts_validate_scope on crm.portal_accounts;
create trigger trg_portal_accounts_validate_scope
before insert or update on crm.portal_accounts
for each row execute procedure crm.ensure_portal_account_scope();

drop trigger if exists trg_portal_accounts_updated_at on crm.portal_accounts;
create trigger trg_portal_accounts_updated_at
before update on crm.portal_accounts
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_portal_invites_validate_scope on crm.portal_invites;
create trigger trg_portal_invites_validate_scope
before insert or update on crm.portal_invites
for each row execute procedure crm.ensure_portal_invite_scope();

drop trigger if exists trg_portal_invites_updated_at on crm.portal_invites;
create trigger trg_portal_invites_updated_at
before update on crm.portal_invites
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_portal_memberships_validate_scope on crm.portal_memberships;
create trigger trg_portal_memberships_validate_scope
before insert or update on crm.portal_memberships
for each row execute procedure crm.ensure_portal_membership_scope();

drop trigger if exists trg_portal_memberships_updated_at on crm.portal_memberships;
create trigger trg_portal_memberships_updated_at
before update on crm.portal_memberships
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_portal_access_logs_validate_scope on crm.portal_access_logs;
create trigger trg_portal_access_logs_validate_scope
before insert or update on crm.portal_access_logs
for each row execute procedure crm.ensure_portal_access_log_scope();

create index if not exists idx_portal_accounts_org_status
  on crm.portal_accounts (organization_id, status);
create index if not exists idx_portal_accounts_org_auth_user
  on crm.portal_accounts (organization_id, auth_user_id);
create index if not exists idx_portal_accounts_org_role
  on crm.portal_accounts (organization_id, role);

create index if not exists idx_portal_invites_org_email_status
  on crm.portal_invites (organization_id, email_normalized, status);
create index if not exists idx_portal_invites_org_project
  on crm.portal_invites (organization_id, project_property_id);
create index if not exists idx_portal_invites_org_expires
  on crm.portal_invites (organization_id, expires_at);

create index if not exists idx_portal_memberships_org_project_status
  on crm.portal_memberships (organization_id, project_property_id, status);
create index if not exists idx_portal_memberships_org_account_status
  on crm.portal_memberships (organization_id, portal_account_id, status);

create index if not exists idx_portal_access_logs_org_created_at
  on crm.portal_access_logs (organization_id, created_at desc);
create index if not exists idx_portal_access_logs_org_event_type
  on crm.portal_access_logs (organization_id, event_type);
create index if not exists idx_portal_access_logs_org_account
  on crm.portal_access_logs (organization_id, portal_account_id);

grant select, insert, update, delete on table crm.portal_accounts to authenticated, service_role;
grant select, insert, update, delete on table crm.portal_invites to authenticated, service_role;
grant select, insert, update, delete on table crm.portal_memberships to authenticated, service_role;
grant select, insert on table crm.portal_access_logs to authenticated, service_role;

grant execute on function crm.ensure_portal_account_scope() to authenticated, service_role;
grant execute on function crm.ensure_portal_invite_scope() to authenticated, service_role;
grant execute on function crm.ensure_portal_membership_scope() to authenticated, service_role;
grant execute on function crm.ensure_portal_access_log_scope() to authenticated, service_role;
