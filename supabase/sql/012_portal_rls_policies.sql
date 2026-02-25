-- Fase 4C modulo portal:
-- - funciones de control de acceso portal
-- - politicas RLS para portal_accounts/invites/memberships/content/ops
-- - lectura controlada de documentos publicados para usuarios portal

create or replace function crm.portal_user_has_org_access(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = crm, public
as $$
  select exists (
    select 1
    from crm.portal_accounts pa
    where pa.organization_id = p_org_id
      and pa.auth_user_id = auth.uid()
      and pa.status = 'active'
  );
$$;

create or replace function crm.portal_user_has_account(p_portal_account_id uuid, p_org_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = crm, public
as $$
  select exists (
    select 1
    from crm.portal_accounts pa
    where pa.id = p_portal_account_id
      and pa.auth_user_id = auth.uid()
      and pa.status = 'active'
      and (p_org_id is null or pa.organization_id = p_org_id)
  );
$$;

create or replace function crm.portal_has_project_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = crm, public
as $$
  select exists (
    select 1
    from crm.properties p
    where p.id = p_project_id
      and p.record_type = 'project'
      and (
        crm.user_has_org_access(p.organization_id)
        or exists (
          select 1
          from crm.portal_memberships pm
          join crm.portal_accounts pa
            on pa.id = pm.portal_account_id
          where pm.project_property_id = p.id
            and pm.organization_id = p.organization_id
            and pm.status = 'active'
            and pa.organization_id = p.organization_id
            and pa.auth_user_id = auth.uid()
            and pa.status = 'active'
        )
      )
  );
$$;

create or replace function crm.portal_audience_allowed(p_org_id uuid, p_audience text)
returns boolean
language sql
stable
security definer
set search_path = crm, public
as $$
  select case
    when p_audience not in ('agent', 'client', 'both') then false
    when crm.user_has_org_access(p_org_id) then true
    when coalesce((
      select pa.role
      from crm.portal_accounts pa
      where pa.organization_id = p_org_id
        and pa.auth_user_id = auth.uid()
        and pa.status = 'active'
      order by pa.created_at asc
      limit 1
    ), '') = 'portal_client' then p_audience in ('client', 'both')
    when coalesce((
      select pa.role
      from crm.portal_accounts pa
      where pa.organization_id = p_org_id
        and pa.auth_user_id = auth.uid()
        and pa.status = 'active'
      order by pa.created_at asc
      limit 1
    ), '') in ('portal_agent_admin', 'portal_agent_member') then p_audience in ('agent', 'both')
    else false
  end;
$$;

create or replace function crm.portal_document_visibility_allowed(p_org_id uuid, p_visibility text)
returns boolean
language sql
stable
security definer
set search_path = crm, public
as $$
  select case
    when p_visibility not in ('crm_only', 'agent', 'client', 'both') then false
    when p_visibility = 'crm_only' then crm.user_has_org_access(p_org_id)
    when crm.user_has_org_access(p_org_id) then true
    when coalesce((
      select pa.role
      from crm.portal_accounts pa
      where pa.organization_id = p_org_id
        and pa.auth_user_id = auth.uid()
        and pa.status = 'active'
      order by pa.created_at asc
      limit 1
    ), '') = 'portal_client' then p_visibility in ('client', 'both')
    when coalesce((
      select pa.role
      from crm.portal_accounts pa
      where pa.organization_id = p_org_id
        and pa.auth_user_id = auth.uid()
        and pa.status = 'active'
      order by pa.created_at asc
      limit 1
    ), '') in ('portal_agent_admin', 'portal_agent_member') then p_visibility in ('agent', 'both')
    else false
  end;
$$;

grant execute on function crm.portal_user_has_org_access(uuid) to authenticated, service_role;
grant execute on function crm.portal_user_has_account(uuid, uuid) to authenticated, service_role;
grant execute on function crm.portal_has_project_access(uuid) to authenticated, service_role;
grant execute on function crm.portal_audience_allowed(uuid, text) to authenticated, service_role;
grant execute on function crm.portal_document_visibility_allowed(uuid, text) to authenticated, service_role;

alter table crm.portal_accounts enable row level security;
alter table crm.portal_invites enable row level security;
alter table crm.portal_memberships enable row level security;
alter table crm.portal_access_logs enable row level security;
alter table crm.portal_content_blocks enable row level security;
alter table crm.portal_lead_tracking enable row level security;
alter table crm.portal_visit_requests enable row level security;
alter table crm.portal_commission_status enable row level security;
alter table crm.documents enable row level security;

drop policy if exists portal_accounts_internal_all on crm.portal_accounts;
create policy portal_accounts_internal_all on crm.portal_accounts
for all using (crm.user_has_org_access(organization_id))
with check (crm.user_has_org_access(organization_id));

drop policy if exists portal_accounts_self_select on crm.portal_accounts;
create policy portal_accounts_self_select on crm.portal_accounts
for select using (auth_user_id = auth.uid());

drop policy if exists portal_invites_internal_all on crm.portal_invites;
create policy portal_invites_internal_all on crm.portal_invites
for all using (crm.user_has_org_access(organization_id))
with check (crm.user_has_org_access(organization_id));

drop policy if exists portal_memberships_internal_all on crm.portal_memberships;
create policy portal_memberships_internal_all on crm.portal_memberships
for all using (crm.user_has_org_access(organization_id))
with check (crm.user_has_org_access(organization_id));

drop policy if exists portal_memberships_self_select on crm.portal_memberships;
create policy portal_memberships_self_select on crm.portal_memberships
for select using (
  crm.portal_user_has_account(portal_account_id, organization_id)
);

drop policy if exists portal_access_logs_internal_all on crm.portal_access_logs;
create policy portal_access_logs_internal_all on crm.portal_access_logs
for all using (crm.user_has_org_access(organization_id))
with check (crm.user_has_org_access(organization_id));

drop policy if exists portal_access_logs_self_select on crm.portal_access_logs;
create policy portal_access_logs_self_select on crm.portal_access_logs
for select using (
  portal_account_id is not null
  and crm.portal_user_has_account(portal_account_id, organization_id)
);

drop policy if exists portal_content_blocks_internal_all on crm.portal_content_blocks;
create policy portal_content_blocks_internal_all on crm.portal_content_blocks
for all using (crm.user_has_org_access(organization_id))
with check (crm.user_has_org_access(organization_id));

drop policy if exists portal_content_blocks_portal_select on crm.portal_content_blocks;
create policy portal_content_blocks_portal_select on crm.portal_content_blocks
for select using (
  is_published = true
  and crm.portal_has_project_access(project_property_id)
  and crm.portal_audience_allowed(organization_id, audience)
);

drop policy if exists portal_lead_tracking_internal_all on crm.portal_lead_tracking;
create policy portal_lead_tracking_internal_all on crm.portal_lead_tracking
for all using (crm.user_has_org_access(organization_id))
with check (crm.user_has_org_access(organization_id));

drop policy if exists portal_lead_tracking_self_select on crm.portal_lead_tracking;
create policy portal_lead_tracking_self_select on crm.portal_lead_tracking
for select using (
  crm.portal_user_has_account(portal_account_id, organization_id)
);

drop policy if exists portal_lead_tracking_self_insert on crm.portal_lead_tracking;
create policy portal_lead_tracking_self_insert on crm.portal_lead_tracking
for insert with check (
  crm.portal_user_has_account(portal_account_id, organization_id)
  and crm.portal_has_project_access(project_property_id)
  and attribution_status in ('pending_review', 'manual_review')
);

drop policy if exists portal_visit_requests_internal_all on crm.portal_visit_requests;
create policy portal_visit_requests_internal_all on crm.portal_visit_requests
for all using (crm.user_has_org_access(organization_id))
with check (crm.user_has_org_access(organization_id));

drop policy if exists portal_visit_requests_self_select on crm.portal_visit_requests;
create policy portal_visit_requests_self_select on crm.portal_visit_requests
for select using (
  crm.portal_user_has_account(portal_account_id, organization_id)
);

drop policy if exists portal_visit_requests_self_insert on crm.portal_visit_requests;
create policy portal_visit_requests_self_insert on crm.portal_visit_requests
for insert with check (
  crm.portal_user_has_account(portal_account_id, organization_id)
  and crm.portal_has_project_access(project_property_id)
  and status = 'requested'
);

drop policy if exists portal_commission_status_internal_all on crm.portal_commission_status;
create policy portal_commission_status_internal_all on crm.portal_commission_status
for all using (crm.user_has_org_access(organization_id))
with check (crm.user_has_org_access(organization_id));

drop policy if exists portal_commission_status_self_select on crm.portal_commission_status;
create policy portal_commission_status_self_select on crm.portal_commission_status
for select using (
  crm.portal_user_has_account(portal_account_id, organization_id)
);

drop policy if exists portal_documents_select on crm.documents;
create policy portal_documents_select on crm.documents
for select using (
  portal_is_published = true
  and portal_visibility <> 'crm_only'
  and project_property_id is not null
  and crm.portal_has_project_access(project_property_id)
  and crm.portal_document_visibility_allowed(organization_id, portal_visibility)
);
