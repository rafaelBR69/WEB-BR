-- Fase 2C modulo clientes:
-- - vinculo legal vivienda <-> cliente
-- - maximo 2 compradores activos (titular + cotitular)
-- - alcance estricto por organizacion y tipo de propiedad

create table if not exists crm.property_client_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  property_id uuid not null references crm.properties(id) on delete cascade,
  client_id uuid not null references crm.clients(id) on delete cascade,
  buyer_role text not null default 'primary' check (
    buyer_role in ('primary', 'co_buyer', 'legal_representative', 'other')
  ),
  civil_status text,
  marital_regime text,
  ownership_share numeric(5, 2) check (
    ownership_share is null or (ownership_share > 0 and ownership_share <= 100)
  ),
  is_active boolean not null default true,
  link_source text not null default 'manual' check (
    link_source in ('manual', 'reservation_import', 'contract_import', 'script', 'other')
  ),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, property_id, client_id)
);

create or replace function crm.ensure_property_client_link_scope()
returns trigger
language plpgsql
as $$
declare
  linked_property_org_id uuid;
  linked_property_record_type crm.property_record_type;
  linked_client_org_id uuid;
  active_buyer_count integer;
  active_primary_count integer;
begin
  select p.organization_id, p.record_type
    into linked_property_org_id, linked_property_record_type
  from crm.properties p
  where p.id = new.property_id;

  if linked_property_org_id is null then
    raise exception 'Property not found for client link: %', new.property_id;
  end if;

  if linked_property_org_id <> new.organization_id then
    raise exception 'Organization mismatch between property and property_client_link';
  end if;

  if linked_property_record_type = 'project' then
    raise exception 'property_client_links only allows record_type unit/single';
  end if;

  select c.organization_id
    into linked_client_org_id
  from crm.clients c
  where c.id = new.client_id;

  if linked_client_org_id is null then
    raise exception 'Client not found for property link: %', new.client_id;
  end if;

  if linked_client_org_id <> new.organization_id then
    raise exception 'Organization mismatch between client and property_client_link';
  end if;

  if new.is_active and new.buyer_role in ('primary', 'co_buyer') then
    if tg_op = 'UPDATE' then
      select count(*)
        into active_buyer_count
      from crm.property_client_links pcl
      where pcl.organization_id = new.organization_id
        and pcl.property_id = new.property_id
        and pcl.is_active = true
        and pcl.buyer_role in ('primary', 'co_buyer')
        and pcl.id <> new.id;
    else
      select count(*)
        into active_buyer_count
      from crm.property_client_links pcl
      where pcl.organization_id = new.organization_id
        and pcl.property_id = new.property_id
        and pcl.is_active = true
        and pcl.buyer_role in ('primary', 'co_buyer');
    end if;

    if active_buyer_count >= 2 then
      raise exception 'Only 2 active buyers are allowed per property (primary + co_buyer)';
    end if;
  end if;

  if new.is_active and new.buyer_role = 'primary' then
    if tg_op = 'UPDATE' then
      select count(*)
        into active_primary_count
      from crm.property_client_links pcl
      where pcl.organization_id = new.organization_id
        and pcl.property_id = new.property_id
        and pcl.is_active = true
        and pcl.buyer_role = 'primary'
        and pcl.id <> new.id;
    else
      select count(*)
        into active_primary_count
      from crm.property_client_links pcl
      where pcl.organization_id = new.organization_id
        and pcl.property_id = new.property_id
        and pcl.is_active = true
        and pcl.buyer_role = 'primary';
    end if;

    if active_primary_count >= 1 then
      raise exception 'Only 1 active primary buyer is allowed per property';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_property_client_links_validate_scope on crm.property_client_links;
create trigger trg_property_client_links_validate_scope
before insert or update on crm.property_client_links
for each row execute procedure crm.ensure_property_client_link_scope();

drop trigger if exists trg_property_client_links_updated_at on crm.property_client_links;
create trigger trg_property_client_links_updated_at
before update on crm.property_client_links
for each row execute procedure crm.set_updated_at();

create index if not exists idx_property_client_links_org_property
  on crm.property_client_links (organization_id, property_id);
create index if not exists idx_property_client_links_org_client
  on crm.property_client_links (organization_id, client_id);
create index if not exists idx_property_client_links_org_property_active
  on crm.property_client_links (organization_id, property_id, is_active);

grant select, insert, update, delete on table crm.property_client_links to authenticated, service_role;
grant execute on function crm.ensure_property_client_link_scope() to authenticated, service_role;

alter table crm.property_client_links enable row level security;

drop policy if exists org_scoped_property_client_links on crm.property_client_links;
create policy org_scoped_property_client_links on crm.property_client_links
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));