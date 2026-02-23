-- Fase 2 del modulo clientes:
-- - validaciones fuertes provider/agencia <-> client por organizacion
-- - triggers de consistencia para evitar enlaces cruzados entre organizaciones

create or replace function crm.ensure_provider_client_scope()
returns trigger
language plpgsql
as $$
declare
  linked_client_org_id uuid;
begin
  select c.organization_id
    into linked_client_org_id
  from crm.clients c
  where c.id = new.client_id;

  if linked_client_org_id is null then
    raise exception 'Provider client not found: %', new.client_id;
  end if;

  if linked_client_org_id <> new.organization_id then
    raise exception 'Organization mismatch between provider and client relation';
  end if;

  return new;
end;
$$;

create or replace function crm.ensure_agency_client_scope()
returns trigger
language plpgsql
as $$
declare
  linked_client_org_id uuid;
begin
  select c.organization_id
    into linked_client_org_id
  from crm.clients c
  where c.id = new.client_id;

  if linked_client_org_id is null then
    raise exception 'Agency client not found: %', new.client_id;
  end if;

  if linked_client_org_id <> new.organization_id then
    raise exception 'Organization mismatch between agency and client relation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_providers_validate_client_scope on crm.providers;
create trigger trg_providers_validate_client_scope
before insert or update on crm.providers
for each row execute procedure crm.ensure_provider_client_scope();

drop trigger if exists trg_agencies_validate_client_scope on crm.agencies;
create trigger trg_agencies_validate_client_scope
before insert or update on crm.agencies
for each row execute procedure crm.ensure_agency_client_scope();

create index if not exists idx_providers_org_client on crm.providers (organization_id, client_id);
create index if not exists idx_agencies_org_client on crm.agencies (organization_id, client_id);

grant execute on function crm.ensure_provider_client_scope() to authenticated, service_role;
grant execute on function crm.ensure_agency_client_scope() to authenticated, service_role;
