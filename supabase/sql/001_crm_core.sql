-- CRM core schema for BlancaReal
-- Compatible with Supabase Postgres

create extension if not exists pgcrypto;
create schema if not exists crm;

create type crm.property_record_type as enum ('project', 'unit', 'single');
create type crm.operation_type as enum ('sale', 'rent', 'both');
create type crm.property_status as enum (
  'draft',
  'available',
  'reserved',
  'sold',
  'rented',
  'private',
  'archived'
);
create type crm.lead_status as enum (
  'new',
  'in_process',
  'qualified',
  'visit_scheduled',
  'offer_sent',
  'negotiation',
  'converted',
  'won',
  'lost',
  'discarded',
  'junk'
);
create type crm.contract_status as enum ('draft', 'sent', 'signed', 'cancelled', 'expired');
create type crm.invoice_status as enum (
  'draft',
  'issued',
  'paid',
  'partially_paid',
  'overdue',
  'cancelled'
);
create type crm.document_scope as enum ('lead', 'client', 'property', 'contract', 'invoice', 'general');
create type crm.agency_status as enum ('active', 'inactive', 'discarded');
create type crm.agency_contact_role as enum ('agent', 'lawyer', 'assistant', 'owner', 'other');
create type crm.lead_origin_type as enum (
  'direct',
  'website',
  'portal',
  'agency',
  'provider',
  'phone',
  'whatsapp',
  'email',
  'other'
);

create table if not exists crm.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  tax_id text,
  default_currency text not null default 'EUR',
  timezone text not null default 'Europe/Madrid',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.websites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  name text not null,
  domain text not null,
  default_language text not null default 'es',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, domain)
);

create table if not exists crm.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'agent', 'finance', 'legal', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists crm.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  contact_type text not null default 'lead' check (contact_type in ('lead', 'client', 'partner', 'vendor', 'agency', 'lawyer')),
  full_name text not null,
  email text,
  phone text,
  preferred_language text default 'es',
  country_code text,
  tags text[] not null default '{}',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  contact_id uuid references crm.contacts(id) on delete set null,
  client_code text,
  client_type text not null default 'individual' check (client_type in ('individual', 'company')),
  client_status text not null default 'active' check (client_status in ('active', 'inactive', 'discarded', 'blacklisted')),
  billing_name text,
  tax_id text,
  billing_address jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_code)
);

create table if not exists crm.providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  client_id uuid not null references crm.clients(id) on delete restrict,
  provider_code text,
  provider_type text not null default 'developer' check (
    provider_type in ('developer', 'promoter', 'constructor', 'architect', 'agency', 'owner', 'other')
  ),
  provider_status text not null default 'active' check (provider_status in ('active', 'inactive')),
  is_billable boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id),
  unique (organization_id, provider_code)
);

create table if not exists crm.agencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  client_id uuid not null references crm.clients(id) on delete restrict,
  agency_code text,
  agency_status crm.agency_status not null default 'active',
  agency_scope text not null default 'mixed' check (agency_scope in ('buyer', 'seller', 'rental', 'mixed')),
  parent_agency_id uuid references crm.agencies(id) on delete set null,
  is_referral_source boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id),
  unique (organization_id, agency_code)
);

create table if not exists crm.agency_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  agency_id uuid not null references crm.agencies(id) on delete cascade,
  contact_id uuid not null references crm.contacts(id) on delete restrict,
  role crm.agency_contact_role not null default 'agent',
  relation_status text not null default 'active' check (relation_status in ('active', 'inactive', 'discarded')),
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, contact_id, role)
);

create table if not exists crm.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  website_id uuid references crm.websites(id) on delete set null,
  legacy_code text not null,
  record_type crm.property_record_type not null default 'single',
  parent_property_id uuid references crm.properties(id) on delete set null,
  operation_type crm.operation_type not null default 'sale',
  listing_type text not null default 'resale' check (listing_type in ('promotion', 'unit', 'resale', 'rental')),
  status crm.property_status not null default 'draft',
  is_featured boolean not null default false,
  is_public boolean not null default true,
  price_sale numeric(14, 2),
  price_rent_monthly numeric(14, 2),
  price_currency text not null default 'EUR',
  location jsonb not null default '{}',
  property_data jsonb not null default '{}',
  features text[] not null default '{}',
  media jsonb not null default '{}',
  translations jsonb not null default '{}',
  slugs jsonb not null default '{}',
  seo jsonb not null default '{}',
  published_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_legacy_code_uq unique (organization_id, legacy_code),
  constraint properties_not_self_parent check (parent_property_id is null or parent_property_id <> id)
);

create table if not exists crm.property_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  property_id uuid not null references crm.properties(id) on delete cascade,
  from_status crm.property_status,
  to_status crm.property_status not null,
  note text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create table if not exists crm.project_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  project_property_id uuid not null references crm.properties(id) on delete cascade,
  provider_id uuid not null references crm.providers(id) on delete restrict,
  responsibility_role text not null default 'promoter' check (
    responsibility_role in ('promoter', 'developer', 'constructor', 'commercial_head', 'exclusive_agent', 'other')
  ),
  commercial_terms jsonb not null default '{}',
  start_date date,
  end_date date,
  is_primary boolean not null default false,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_property_id, provider_id, responsibility_role)
);

create table if not exists crm.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  website_id uuid references crm.websites(id) on delete set null,
  property_id uuid references crm.properties(id) on delete set null,
  contact_id uuid references crm.contacts(id) on delete set null,
  agency_id uuid references crm.agencies(id) on delete set null,
  provider_id uuid references crm.providers(id) on delete set null,
  referred_contact_id uuid references crm.contacts(id) on delete set null,
  lead_kind text not null default 'buyer' check (
    lead_kind in ('buyer', 'seller', 'landlord', 'tenant', 'investor', 'agency', 'provider', 'other')
  ),
  origin_type crm.lead_origin_type not null default 'website',
  source text not null default 'web_form',
  status crm.lead_status not null default 'new',
  priority smallint not null default 3 check (priority between 1 and 5),
  operation_interest crm.operation_type not null default 'sale',
  budget_min numeric(14, 2),
  budget_max numeric(14, 2),
  discarded_reason text,
  discarded_at timestamptz,
  converted_client_id uuid references crm.clients(id) on delete set null,
  converted_agency_id uuid references crm.agencies(id) on delete set null,
  converted_at timestamptz,
  raw_payload jsonb not null default '{}',
  assigned_to uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  lead_id uuid references crm.leads(id) on delete set null,
  client_id uuid references crm.clients(id) on delete set null,
  property_id uuid references crm.properties(id) on delete set null,
  title text not null,
  stage text not null default 'negotiation',
  expected_close_date date,
  expected_value numeric(14, 2),
  currency text not null default 'EUR',
  probability smallint not null default 20 check (probability between 0 and 100),
  owner_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  lead_id uuid references crm.leads(id) on delete set null,
  client_id uuid references crm.clients(id) on delete set null,
  deal_id uuid references crm.deals(id) on delete set null,
  property_id uuid references crm.properties(id) on delete set null,
  activity_type text not null check (activity_type in ('call', 'email', 'meeting', 'visit', 'task', 'note')),
  subject text not null,
  details text,
  scheduled_for timestamptz,
  done_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists crm.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  client_id uuid not null references crm.clients(id) on delete restrict,
  property_id uuid references crm.properties(id) on delete set null,
  deal_id uuid references crm.deals(id) on delete set null,
  contract_number text not null,
  contract_type text not null default 'sale' check (contract_type in ('sale', 'rent', 'service')),
  status crm.contract_status not null default 'draft',
  start_date date,
  end_date date,
  signed_at timestamptz,
  total_amount numeric(14, 2),
  currency text not null default 'EUR',
  terms jsonb not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contract_number)
);

create table if not exists crm.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  client_id uuid not null references crm.clients(id) on delete restrict,
  contract_id uuid references crm.contracts(id) on delete set null,
  invoice_number text not null,
  status crm.invoice_status not null default 'draft',
  issue_date date not null default current_date,
  due_date date,
  subtotal numeric(14, 2) not null default 0,
  tax_amount numeric(14, 2) not null default 0,
  total_amount numeric(14, 2) generated always as (subtotal + tax_amount) stored,
  currency text not null default 'EUR',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, invoice_number)
);

create table if not exists crm.invoice_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  invoice_id uuid not null references crm.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12, 2) not null default 1 check (quantity > 0),
  unit_price numeric(14, 2) not null default 0,
  tax_rate numeric(5, 2) not null default 0,
  line_total numeric(14, 2) generated always as (quantity * unit_price) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists crm.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  scope crm.document_scope not null default 'general',
  lead_id uuid references crm.leads(id) on delete set null,
  client_id uuid references crm.clients(id) on delete set null,
  property_id uuid references crm.properties(id) on delete set null,
  contract_id uuid references crm.contracts(id) on delete set null,
  invoice_id uuid references crm.invoices(id) on delete set null,
  title text not null,
  storage_bucket text not null default 'crm-documents',
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint,
  is_private boolean not null default true,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists crm.custom_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('contact', 'lead', 'client', 'agency', 'provider', 'property', 'deal', 'contract', 'invoice')),
  field_key text not null,
  label text not null,
  field_type text not null default 'text' check (field_type in ('text', 'number', 'date', 'boolean', 'select', 'multiselect', 'json')),
  options jsonb not null default '[]',
  is_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity_type, field_key)
);

create table if not exists crm.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references crm.organizations(id) on delete cascade,
  custom_field_id uuid not null references crm.custom_fields(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  value_text text,
  value_number numeric(14, 2),
  value_date date,
  value_boolean boolean,
  value_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (custom_field_id, entity_id)
);

create index if not exists idx_websites_org on crm.websites (organization_id);
create index if not exists idx_memberships_org_user on crm.memberships (organization_id, user_id);
create index if not exists idx_contacts_org on crm.contacts (organization_id);
create index if not exists idx_contacts_org_email on crm.contacts (organization_id, lower(email));
create index if not exists idx_clients_org on crm.clients (organization_id);
create index if not exists idx_providers_org on crm.providers (organization_id);
create index if not exists idx_providers_org_status on crm.providers (organization_id, provider_status);
create index if not exists idx_agencies_org on crm.agencies (organization_id);
create index if not exists idx_agencies_org_status on crm.agencies (organization_id, agency_status);
create index if not exists idx_agency_contacts_org on crm.agency_contacts (organization_id);
create index if not exists idx_agency_contacts_agency on crm.agency_contacts (agency_id);
create index if not exists idx_properties_org on crm.properties (organization_id);
create index if not exists idx_properties_org_record_type on crm.properties (organization_id, record_type);
create index if not exists idx_properties_org_operation_type on crm.properties (organization_id, operation_type);
create index if not exists idx_properties_parent on crm.properties (parent_property_id);
create index if not exists idx_properties_status on crm.properties (status);
create index if not exists idx_project_providers_org on crm.project_providers (organization_id);
create index if not exists idx_project_providers_project on crm.project_providers (project_property_id);
create index if not exists idx_project_providers_provider on crm.project_providers (provider_id);
create index if not exists idx_leads_org_status on crm.leads (organization_id, status);
create index if not exists idx_leads_org_origin on crm.leads (organization_id, origin_type);
create index if not exists idx_leads_agency on crm.leads (agency_id);
create index if not exists idx_leads_provider on crm.leads (provider_id);
create index if not exists idx_deals_org_stage on crm.deals (organization_id, stage);
create index if not exists idx_contracts_org_status on crm.contracts (organization_id, status);
create index if not exists idx_invoices_org_status on crm.invoices (organization_id, status);
create index if not exists idx_documents_org_scope on crm.documents (organization_id, scope);

create or replace function crm.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_organizations_updated_at on crm.organizations;
create trigger trg_organizations_updated_at
before update on crm.organizations
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_websites_updated_at on crm.websites;
create trigger trg_websites_updated_at
before update on crm.websites
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_contacts_updated_at on crm.contacts;
create trigger trg_contacts_updated_at
before update on crm.contacts
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_clients_updated_at on crm.clients;
create trigger trg_clients_updated_at
before update on crm.clients
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_providers_updated_at on crm.providers;
create trigger trg_providers_updated_at
before update on crm.providers
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_agencies_updated_at on crm.agencies;
create trigger trg_agencies_updated_at
before update on crm.agencies
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_agency_contacts_updated_at on crm.agency_contacts;
create trigger trg_agency_contacts_updated_at
before update on crm.agency_contacts
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_properties_updated_at on crm.properties;
create trigger trg_properties_updated_at
before update on crm.properties
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_project_providers_updated_at on crm.project_providers;
create trigger trg_project_providers_updated_at
before update on crm.project_providers
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_leads_updated_at on crm.leads;
create trigger trg_leads_updated_at
before update on crm.leads
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_deals_updated_at on crm.deals;
create trigger trg_deals_updated_at
before update on crm.deals
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_contracts_updated_at on crm.contracts;
create trigger trg_contracts_updated_at
before update on crm.contracts
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_invoices_updated_at on crm.invoices;
create trigger trg_invoices_updated_at
before update on crm.invoices
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_custom_fields_updated_at on crm.custom_fields;
create trigger trg_custom_fields_updated_at
before update on crm.custom_fields
for each row execute procedure crm.set_updated_at();

drop trigger if exists trg_custom_field_values_updated_at on crm.custom_field_values;
create trigger trg_custom_field_values_updated_at
before update on crm.custom_field_values
for each row execute procedure crm.set_updated_at();

create or replace function crm.user_has_org_access(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = crm, public
as $$
  select exists (
    select 1
    from crm.memberships m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.is_active
  );
$$;

create or replace function crm.ensure_project_provider_target()
returns trigger
language plpgsql
as $$
declare
  project_record_type crm.property_record_type;
  project_org_id uuid;
  provider_org_id uuid;
begin
  select p.record_type, p.organization_id
    into project_record_type, project_org_id
  from crm.properties p
  where p.id = new.project_property_id;

  if project_record_type is null then
    raise exception 'Project property not found: %', new.project_property_id;
  end if;

  if project_record_type <> 'project' then
    raise exception 'project_property_id % must point to a property with record_type=project', new.project_property_id;
  end if;

  if project_org_id <> new.organization_id then
    raise exception 'Organization mismatch between project and project_providers row';
  end if;

  select pr.organization_id
    into provider_org_id
  from crm.providers pr
  where pr.id = new.provider_id;

  if provider_org_id is null then
    raise exception 'Provider not found: %', new.provider_id;
  end if;

  if provider_org_id <> new.organization_id then
    raise exception 'Organization mismatch between provider and project_providers row';
  end if;

  return new;
end;
$$;

create or replace function crm.ensure_agency_contact_scope()
returns trigger
language plpgsql
as $$
declare
  agency_org_id uuid;
  contact_org_id uuid;
begin
  select a.organization_id
    into agency_org_id
  from crm.agencies a
  where a.id = new.agency_id;

  if agency_org_id is null then
    raise exception 'Agency not found: %', new.agency_id;
  end if;

  select c.organization_id
    into contact_org_id
  from crm.contacts c
  where c.id = new.contact_id;

  if contact_org_id is null then
    raise exception 'Contact not found: %', new.contact_id;
  end if;

  if agency_org_id <> new.organization_id or contact_org_id <> new.organization_id then
    raise exception 'Organization mismatch in agency_contacts relation';
  end if;

  return new;
end;
$$;

create or replace function crm.ensure_lead_links_scope()
returns trigger
language plpgsql
as $$
declare
  linked_org_id uuid;
begin
  if new.agency_id is not null and new.provider_id is not null then
    raise exception 'Lead cannot reference agency and provider at the same time';
  end if;

  if new.origin_type = 'agency' and new.agency_id is null then
    raise exception 'origin_type=agency requires agency_id';
  end if;

  if new.origin_type = 'provider' and new.provider_id is null then
    raise exception 'origin_type=provider requires provider_id';
  end if;

  if new.status = 'converted' and new.agency_id is null then
    raise exception 'status=converted requires agency_id';
  end if;

  if new.agency_id is not null then
    select a.organization_id
      into linked_org_id
    from crm.agencies a
    where a.id = new.agency_id;
    if linked_org_id is null then
      raise exception 'Agency not found: %', new.agency_id;
    end if;
    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between lead and agency';
    end if;
  end if;

  if new.provider_id is not null then
    select p.organization_id
      into linked_org_id
    from crm.providers p
    where p.id = new.provider_id;
    if linked_org_id is null then
      raise exception 'Provider not found: %', new.provider_id;
    end if;
    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between lead and provider';
    end if;
  end if;

  if new.contact_id is not null then
    select c.organization_id
      into linked_org_id
    from crm.contacts c
    where c.id = new.contact_id;
    if linked_org_id is null then
      raise exception 'Contact not found: %', new.contact_id;
    end if;
    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between lead and contact';
    end if;
  end if;

  if new.referred_contact_id is not null then
    select c.organization_id
      into linked_org_id
    from crm.contacts c
    where c.id = new.referred_contact_id;
    if linked_org_id is null then
      raise exception 'Referred contact not found: %', new.referred_contact_id;
    end if;
    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between lead and referred_contact';
    end if;
  end if;

  if new.property_id is not null then
    select p.organization_id
      into linked_org_id
    from crm.properties p
    where p.id = new.property_id;
    if linked_org_id is null then
      raise exception 'Property not found: %', new.property_id;
    end if;
    if linked_org_id <> new.organization_id then
      raise exception 'Organization mismatch between lead and property';
    end if;
  end if;

  if new.status = 'discarded' and new.discarded_at is null then
    new.discarded_at := now();
  end if;

  return new;
end;
$$;

create or replace function crm.convert_lead_to_agency(p_lead_id uuid, p_agency_code text default null)
returns uuid
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_lead crm.leads%rowtype;
  v_contact crm.contacts%rowtype;
  v_client_id uuid;
  v_agency_id uuid;
  v_client_code text;
begin
  select *
    into v_lead
  from crm.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found: %', p_lead_id;
  end if;

  if v_lead.organization_id is null then
    raise exception 'Lead organization is required';
  end if;

  if v_lead.contact_id is null then
    raise exception 'Lead % has no contact_id; cannot convert to agency', p_lead_id;
  end if;

  if v_lead.converted_agency_id is not null then
    return v_lead.converted_agency_id;
  end if;

  select *
    into v_contact
  from crm.contacts c
  where c.id = v_lead.contact_id
  for update;

  if not found then
    raise exception 'Lead contact not found: %', v_lead.contact_id;
  end if;

  select c.id
    into v_client_id
  from crm.clients c
  where c.organization_id = v_lead.organization_id
    and c.contact_id = v_lead.contact_id
  limit 1;

  if v_client_id is null then
    v_client_code := 'CLI-AG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into crm.clients (
      organization_id,
      contact_id,
      client_code,
      client_type,
      client_status,
      billing_name
    )
    values (
      v_lead.organization_id,
      v_lead.contact_id,
      v_client_code,
      'company',
      'active',
      v_contact.full_name
    )
    returning id into v_client_id;
  end if;

  select a.id
    into v_agency_id
  from crm.agencies a
  where a.organization_id = v_lead.organization_id
    and a.client_id = v_client_id
  limit 1;

  if v_agency_id is null then
    insert into crm.agencies (
      organization_id,
      client_id,
      agency_code,
      agency_status,
      agency_scope
    )
    values (
      v_lead.organization_id,
      v_client_id,
      coalesce(p_agency_code, 'AG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
      'active',
      'mixed'
    )
    returning id into v_agency_id;
  end if;

  update crm.contacts
    set contact_type = case
      when contact_type = 'lawyer' then contact_type
      else 'agency'
    end
  where id = v_lead.contact_id;

  update crm.leads
    set status = 'converted',
        lead_kind = 'agency',
        origin_type = 'agency',
        agency_id = v_agency_id,
        converted_client_id = v_client_id,
        converted_agency_id = v_agency_id,
        converted_at = now(),
        updated_at = now()
  where id = p_lead_id;

  return v_agency_id;
end;
$$;

drop trigger if exists trg_agency_contacts_validate on crm.agency_contacts;
create trigger trg_agency_contacts_validate
before insert or update on crm.agency_contacts
for each row execute procedure crm.ensure_agency_contact_scope();

drop trigger if exists trg_project_providers_validate on crm.project_providers;
create trigger trg_project_providers_validate
before insert or update on crm.project_providers
for each row execute procedure crm.ensure_project_provider_target();

drop trigger if exists trg_leads_validate on crm.leads;
create trigger trg_leads_validate
before insert or update on crm.leads
for each row execute procedure crm.ensure_lead_links_scope();

grant usage on schema crm to authenticated, service_role;
grant all on all tables in schema crm to service_role;
grant all on all sequences in schema crm to service_role;
grant execute on function crm.set_updated_at() to authenticated, service_role;
grant execute on function crm.user_has_org_access(uuid) to authenticated, service_role;
grant execute on function crm.ensure_project_provider_target() to authenticated, service_role;
grant execute on function crm.ensure_agency_contact_scope() to authenticated, service_role;
grant execute on function crm.ensure_lead_links_scope() to authenticated, service_role;
grant execute on function crm.convert_lead_to_agency(uuid, text) to authenticated, service_role;

alter table crm.organizations enable row level security;
alter table crm.websites enable row level security;
alter table crm.memberships enable row level security;
alter table crm.contacts enable row level security;
alter table crm.clients enable row level security;
alter table crm.providers enable row level security;
alter table crm.agencies enable row level security;
alter table crm.agency_contacts enable row level security;
alter table crm.properties enable row level security;
alter table crm.property_status_history enable row level security;
alter table crm.project_providers enable row level security;
alter table crm.leads enable row level security;
alter table crm.deals enable row level security;
alter table crm.activities enable row level security;
alter table crm.contracts enable row level security;
alter table crm.invoices enable row level security;
alter table crm.invoice_items enable row level security;
alter table crm.documents enable row level security;
alter table crm.custom_fields enable row level security;
alter table crm.custom_field_values enable row level security;

drop policy if exists organizations_select on crm.organizations;
create policy organizations_select on crm.organizations
for select using (crm.user_has_org_access(id));

drop policy if exists organizations_insert on crm.organizations;
create policy organizations_insert on crm.organizations
for insert with check (auth.role() = 'authenticated');

drop policy if exists organizations_update on crm.organizations;
create policy organizations_update on crm.organizations
for update using (crm.user_has_org_access(id)) with check (crm.user_has_org_access(id));

drop policy if exists memberships_select on crm.memberships;
create policy memberships_select on crm.memberships
for select using (crm.user_has_org_access(organization_id));

drop policy if exists memberships_insert on crm.memberships;
create policy memberships_insert on crm.memberships
for insert with check (crm.user_has_org_access(organization_id));

drop policy if exists memberships_update on crm.memberships;
create policy memberships_update on crm.memberships
for update using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_websites on crm.websites;
create policy org_scoped_websites on crm.websites
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_contacts on crm.contacts;
create policy org_scoped_contacts on crm.contacts
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_clients on crm.clients;
create policy org_scoped_clients on crm.clients
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_providers on crm.providers;
create policy org_scoped_providers on crm.providers
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_agencies on crm.agencies;
create policy org_scoped_agencies on crm.agencies
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_agency_contacts on crm.agency_contacts;
create policy org_scoped_agency_contacts on crm.agency_contacts
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_properties on crm.properties;
create policy org_scoped_properties on crm.properties
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_property_status_history on crm.property_status_history;
create policy org_scoped_property_status_history on crm.property_status_history
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_project_providers on crm.project_providers;
create policy org_scoped_project_providers on crm.project_providers
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_leads on crm.leads;
create policy org_scoped_leads on crm.leads
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_deals on crm.deals;
create policy org_scoped_deals on crm.deals
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_activities on crm.activities;
create policy org_scoped_activities on crm.activities
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_contracts on crm.contracts;
create policy org_scoped_contracts on crm.contracts
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_invoices on crm.invoices;
create policy org_scoped_invoices on crm.invoices
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_invoice_items on crm.invoice_items;
create policy org_scoped_invoice_items on crm.invoice_items
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_documents on crm.documents;
create policy org_scoped_documents on crm.documents
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_custom_fields on crm.custom_fields;
create policy org_scoped_custom_fields on crm.custom_fields
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));

drop policy if exists org_scoped_custom_field_values on crm.custom_field_values;
create policy org_scoped_custom_field_values on crm.custom_field_values
for all using (crm.user_has_org_access(organization_id)) with check (crm.user_has_org_access(organization_id));
