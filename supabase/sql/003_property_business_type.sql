-- Incremental migration:
-- Adds business model distinction for properties/projects.
-- Safe to run after 001_crm_core.sql was already executed.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'crm'
      and t.typname = 'project_business_type'
  ) then
    create type crm.project_business_type as enum (
      'owned_and_commercialized',
      'provider_and_commercialized_by_us',
      'external_listing'
    );
  end if;
end;
$$;

alter table crm.properties
  add column if not exists project_business_type crm.project_business_type not null default 'external_listing',
  add column if not exists commercialization_notes text;

create index if not exists idx_properties_org_business_type
  on crm.properties (organization_id, project_business_type);
