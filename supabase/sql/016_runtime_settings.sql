-- Runtime settings shared by web and CRM deployments

create table if not exists crm.runtime_settings (
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table crm.runtime_settings enable row level security;

drop trigger if exists trg_runtime_settings_updated_at on crm.runtime_settings;
create trigger trg_runtime_settings_updated_at
before update on crm.runtime_settings
for each row execute procedure crm.set_updated_at();

grant select, insert, update on table crm.runtime_settings to service_role;
