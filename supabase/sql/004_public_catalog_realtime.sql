-- Incremental migration:
-- Public catalog read policy + realtime publication for crm.properties.
-- Safe to run after 001_crm_core.sql.

grant usage on schema crm to anon;
grant select on crm.properties to anon;

drop policy if exists public_catalog_properties_select on crm.properties;
create policy public_catalog_properties_select on crm.properties
for select
to anon
using (
  is_public = true
  and status <> 'private'
  and status <> 'archived'
);

alter table crm.properties replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
      join pg_namespace n on n.oid = c.relnamespace
      where p.pubname = 'supabase_realtime'
        and n.nspname = 'crm'
        and c.relname = 'properties'
    ) then
      execute 'alter publication supabase_realtime add table crm.properties';
    end if;
  end if;
end;
$$;

