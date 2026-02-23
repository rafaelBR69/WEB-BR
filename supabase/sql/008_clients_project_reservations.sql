-- Fase 2B del modulo clientes:
-- - relacion estructurada cliente <-> promocion (compradores/reservas)
-- - validaciones fuertes de alcance por organizacion

create table if not exists crm.client_project_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  client_id uuid not null references crm.clients(id) on delete cascade,
  project_property_id uuid not null references crm.properties(id) on delete cascade,
  source_file text not null,
  source_row_number integer not null check (source_row_number > 0),
  reservation_status text not null default 'other' check (
    reservation_status in (
      'pre_registered',
      'reserved',
      'reservation_sent',
      'contract_signed',
      'adhesion_paid',
      'cancelled',
      'discarded',
      'other'
    )
  ),
  reservation_state_text text,
  reservation_date date,
  pre_registration_date date,
  reservation_paid_date date,
  adhesion_paid_date date,
  drop_date date,
  interest_date date,
  transaction_cycle_days integer check (transaction_cycle_days is null or transaction_cycle_days >= 0),
  price_without_vat numeric(14, 2),
  price_with_vat numeric(14, 2),
  price_with_increment numeric(14, 2),
  increment_amount numeric(14, 2),
  ppc_amount numeric(14, 2),
  ppc_balance_amount numeric(14, 2),
  adhesion_amount numeric(14, 2),
  commission_rate numeric(6, 3),
  agency_commission_amount numeric(14, 2),
  internal_commission_amount numeric(14, 2),
  unit_reference text,
  unit_portal text,
  unit_floor text,
  unit_letter text,
  parking_reference text,
  storage_reference text,
  document_type text,
  document_verification text,
  is_direct_sale boolean,
  is_agency_sale boolean,
  is_collaboration_contract_signed boolean,
  is_reservation_paid boolean,
  is_contract_paid boolean,
  is_pre_registration_paid boolean,
  is_adhesion_paid boolean,
  is_reservation_contract_signed boolean,
  is_adhesion_contract_signed boolean,
  is_document_copy_received boolean,
  is_aml_form_received boolean,
  is_uploaded_to_folder boolean,
  is_represented_by_lawyer boolean,
  buyer_civil_status text,
  buyer_motivation text,
  agency_name text,
  agency_contact text,
  agent_name text,
  lawyer_name text,
  lawyer_contact text,
  comments text,
  follow_up_comments text,
  commercial_comments text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_property_id, source_file, source_row_number)
);

create or replace function crm.ensure_client_project_reservation_scope()
returns trigger
language plpgsql
as $$
declare
  linked_client_org_id uuid;
  linked_project_org_id uuid;
  linked_project_record_type crm.property_record_type;
begin
  select c.organization_id
    into linked_client_org_id
  from crm.clients c
  where c.id = new.client_id;

  if linked_client_org_id is null then
    raise exception 'Reservation client not found: %', new.client_id;
  end if;

  if linked_client_org_id <> new.organization_id then
    raise exception 'Organization mismatch between reservation and client relation';
  end if;

  select p.organization_id, p.record_type
    into linked_project_org_id, linked_project_record_type
  from crm.properties p
  where p.id = new.project_property_id;

  if linked_project_org_id is null then
    raise exception 'Reservation project not found: %', new.project_property_id;
  end if;

  if linked_project_org_id <> new.organization_id then
    raise exception 'Organization mismatch between reservation and project relation';
  end if;

  if linked_project_record_type <> 'project' then
    raise exception 'Reservation project must target crm.properties record_type=project';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_client_project_reservations_validate_scope on crm.client_project_reservations;
create trigger trg_client_project_reservations_validate_scope
before insert or update on crm.client_project_reservations
for each row execute procedure crm.ensure_client_project_reservation_scope();

drop trigger if exists trg_client_project_reservations_updated_at on crm.client_project_reservations;
create trigger trg_client_project_reservations_updated_at
before update on crm.client_project_reservations
for each row execute procedure crm.set_updated_at();

create index if not exists idx_client_project_reservations_org_project
  on crm.client_project_reservations (organization_id, project_property_id);
create index if not exists idx_client_project_reservations_org_client
  on crm.client_project_reservations (organization_id, client_id);
create index if not exists idx_client_project_reservations_org_status
  on crm.client_project_reservations (organization_id, reservation_status);
create index if not exists idx_client_project_reservations_org_reservation_date
  on crm.client_project_reservations (organization_id, reservation_date);
create index if not exists idx_client_project_reservations_org_source
  on crm.client_project_reservations (organization_id, source_file, source_row_number);

grant select, insert, update, delete on table crm.client_project_reservations to authenticated, service_role;
grant execute on function crm.ensure_client_project_reservation_scope() to authenticated, service_role;

alter table crm.client_project_reservations enable row level security;

drop policy if exists org_scoped_client_project_reservations on crm.client_project_reservations;
create policy org_scoped_client_project_reservations on crm.client_project_reservations
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));
